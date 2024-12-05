import {
    createJupiterApiClient,
    DefaultApi,
    Configuration,
    ConfigurationParameters,
    QuoteGetRequest,
    ApiResponse,
    QuoteResponse,
    InitOverrideFunction,
    SwapInstructionsPostRequest,
    SwapInstructionsResponse,
    SwapPostRequest,
    SwapResponse,
    QuoteGetSwapModeEnum,
    instanceOfQuoteResponse,
    Instruction,
} from '@jup-ag/api';
import {
    AddressLookupTableAccount,
    Connection,
    PublicKey,
    TransactionInstruction,
} from '@solana/web3.js';
import {
    CompressedQuoteGetRequest,
    defaultQuoteGetRequest,
    TokenCompressionMode,
} from './defaultConfigs.ts';
import {
    createAssociatedTokenAccountInstruction,
    createCloseAccountInstruction,
    getAssociatedTokenAddress,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
    CompressedTokenProgram,
    CompressSplTokenAccountParams,
    selectMinCompressedTokenAccountsForTransfer,
} from '@lightprotocol/compressed-token';
import {
    bn,
    BN254,
    defaultTestStateTreeAccounts,
    parseTokenLayoutWithIdl,
    Rpc,
} from '@lightprotocol/stateless.js';

const serializeInstruction = (
    instruction: TransactionInstruction,
): Instruction => ({
    programId: instruction.programId.toBase58(),
    accounts: instruction.keys.map(key => ({
        pubkey: key.pubkey.toBase58(),
        isSigner: key.isSigner,
        isWritable: key.isWritable,
    })),
    data: Buffer.from(instruction.data).toString('base64'),
});

const deserializeInstruction = (
    instruction: Instruction,
): TransactionInstruction =>
    new TransactionInstruction({
        programId: new PublicKey(instruction.programId),
        keys: instruction.accounts.map(key => ({
            pubkey: new PublicKey(key.pubkey),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
        })),
        data: Buffer.from(instruction.data, 'base64'),
    });

const setupAtaInstructions = async (
    connection: Rpc,
    userPublicKey: PublicKey,
    inputMint: PublicKey,
    outputMint: PublicKey,
    compressionMode: TokenCompressionMode,
    skipUserAccountsRpcCalls: boolean,
): Promise<TransactionInstruction[]> => {
    if (skipUserAccountsRpcCalls) return [];

    const instructions: TransactionInstruction[] = [];
    const [inputAta, outputAta] = await Promise.all([
        getAssociatedTokenAddress(inputMint, userPublicKey),
        getAssociatedTokenAddress(outputMint, userPublicKey),
    ]);

    if (compressionMode !== TokenCompressionMode.CompressOutput) {
        const inputAtaInfo = await connection.getAccountInfo(inputAta);
        if (!inputAtaInfo) {
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    userPublicKey,
                    inputAta,
                    userPublicKey,
                    inputMint,
                ),
            );
        }
    }

    const outputAtaInfo = await connection.getAccountInfo(outputAta);
    if (!outputAtaInfo) {
        instructions.push(
            createAssociatedTokenAccountInstruction(
                userPublicKey,
                outputAta,
                userPublicKey,
                outputMint,
            ),
        );
    }

    return instructions;
};
const getDecompressionSetupInstructions = async (
    inputMint: PublicKey,
    inAmount: string,
    connection: Rpc,
    userPublicKey: PublicKey,
    compressionMode: TokenCompressionMode,
    outputStateTree: PublicKey,
): Promise<TransactionInstruction[]> => {
    if (
        compressionMode !== TokenCompressionMode.DecompressInput &&
        compressionMode !== TokenCompressionMode.DecompressAndCompress
    ) {
        return [];
    }

    const inputAta = await getAssociatedTokenAddress(inputMint, userPublicKey);
    return [
        await getDecompressTokenInstruction(
            inputMint,
            bn(inAmount),
            connection,
            userPublicKey,
            inputAta,
            TOKEN_PROGRAM_ID,
            outputStateTree,
        ),
    ];
};

const getCompressTokenOutInstruction = async (
    mint: PublicKey,
    owner: PublicKey,
    ata: PublicKey,
    outputStateTree: PublicKey,
): Promise<TransactionInstruction> => {
    const param: CompressSplTokenAccountParams = {
        feePayer: owner,
        mint,
        tokenAccount: ata,
        authority: owner,
        outputStateTree,
    };
    return await CompressedTokenProgram.compressSplTokenAccount(param);
};

const getDecompressTokenInstruction = async (
    mint: PublicKey,
    amount: number,
    connection: Rpc,
    owner: PublicKey,
    ata: PublicKey,
    tokenProgramId: PublicKey,
    outputStateTree: PublicKey,
): Promise<TransactionInstruction> => {
    amount = bn(amount);

    const compressedTokenAccounts = (
        await connection.getCompressedAccountsByOwner(tokenProgramId)
    ).items
        .map(acc => ({
            compressedAccount: acc,
            parsed: parseTokenLayoutWithIdl(acc, tokenProgramId)!,
        }))
        .filter(acc => acc.parsed.mint.equals(mint));

    const [inputAccounts] = selectMinCompressedTokenAccountsForTransfer(
        compressedTokenAccounts,
        amount,
    );

    const proof = await connection.getValidityProof(
        inputAccounts.map(account => bn(account.compressedAccount.hash)),
    );

    return await CompressedTokenProgram.decompress({
        payer: owner,
        inputCompressedTokenAccounts: inputAccounts,
        toAddress: ata,
        amount,
        outputStateTree,
        recentInputStateRootIndices: proof.rootIndices,
        recentValidityProof: proof.compressedProof,
    });
};

const getCleanupInstructions = async (
    compressionMode: TokenCompressionMode,
    userPublicKey: PublicKey,
    inputMint: PublicKey,
    outputMint: PublicKey,
): Promise<TransactionInstruction[]> => {
    const instructions: TransactionInstruction[] = [];
    const [inputAta, outputAta] = await Promise.all([
        getAssociatedTokenAddress(inputMint, userPublicKey),
        getAssociatedTokenAddress(outputMint, userPublicKey),
    ]);

    if (
        compressionMode === TokenCompressionMode.DecompressInput ||
        compressionMode === TokenCompressionMode.DecompressAndCompress
    ) {
        instructions.push(
            createCloseAccountInstruction(
                inputAta,
                userPublicKey,
                userPublicKey,
            ),
        );
    }

    // Not supported yet
    // TODO: must add replacment for handling wsol then. / unwrapping.
    // if (
    //     compressionMode === TokenCompressionMode.CompressOutput ||
    //     compressionMode === TokenCompressionMode.DecompressAndCompress
    // ) {
    //     instructions.push(
    //         await getCompressTokenOutInstruction(
    //             outputMint,
    //             userPublicKey,
    //             outputAta,
    //             defaultTestStateTreeAccounts().merkleTree,
    //         ),
    //         createCloseAccountInstruction(
    //             outputAta,
    //             userPublicKey,
    //             userPublicKey,
    //         ),
    //     );
    // }

    return instructions;
};

export async function createJupiterApiAdapterClient(
    connection: Rpc,
    config?: ConfigurationParameters,
): Promise<DefaultApi> {
    return new DefaultApiAdapter(new Configuration(config), connection);
}

export class DefaultApiAdapter extends DefaultApi {
    private connection: Rpc;

    constructor(config: Configuration, connection: Rpc) {
        super(config);
        this.connection = connection;
    }

    private validateQuoteGetParams(params: QuoteGetRequest): QuoteGetRequest {
        const {
            restrictIntermediateTokens,
            asLegacyTransaction,
            onlyDirectRoutes,
            maxAccounts,
            swapMode,
            ...rest
        } = params;

        if (swapMode !== QuoteGetSwapModeEnum.ExactIn) {
            throw new Error('Only ExactIn swap mode is supported');
        }

        if (asLegacyTransaction) {
            throw new Error('Legacy transactions are not supported');
        }

        return {
            ...rest,
            maxAccounts: maxAccounts ?? defaultQuoteGetRequest.maxAccounts,
            onlyDirectRoutes:
                onlyDirectRoutes ?? defaultQuoteGetRequest.onlyDirectRoutes,
            restrictIntermediateTokens:
                restrictIntermediateTokens ??
                defaultQuoteGetRequest.restrictIntermediateTokens,
            swapMode: defaultQuoteGetRequest.swapMode,
            asLegacyTransaction: defaultQuoteGetRequest.asLegacyTransaction,
        };
    }

    private validateCompressionMode(mode: TokenCompressionMode): void {
        if (mode !== TokenCompressionMode.DecompressInput) {
            throw new Error(
                `Compression mode: ${mode} not supported yet. Reach out to support@lightprotocol.com for an ETA.`,
            );
        }
    }

    async quoteGetCompressed(
        requestParameters: QuoteGetRequest,
        compressionMode: TokenCompressionMode,
        initOverrides?: RequestInit,
    ): Promise<QuoteResponse> {
        this.validateCompressionMode(compressionMode);
        const params = this.validateQuoteGetParams(requestParameters);
        return super.quoteGet(params, initOverrides);
    }

    async quoteGetRawCompressed(
        requestParameters: QuoteGetRequest,
        compressionMode: TokenCompressionMode,
        initOverrides?: RequestInit | InitOverrideFunction,
    ): Promise<ApiResponse<QuoteResponse>> {
        this.validateCompressionMode(compressionMode);
        const params = this.validateQuoteGetParams(requestParameters);
        return super.quoteGetRaw(params, initOverrides);
    }

    async swapInstructionsPostCompressed(
        requestParameters: SwapInstructionsPostRequest,
        compressionParameters: {
            compressionMode: TokenCompressionMode;
            outputStateTree?: PublicKey;
        },
        initOverrides?: RequestInit | InitOverrideFunction,
    ): Promise<
        Omit<SwapInstructionsResponse, 'cleanupInstruction'> & {
            cleanupInstructions: Array<Instruction>;
        }
    > {
        this.validateCompressionMode(compressionParameters.compressionMode);

        const { swapRequest } = requestParameters;
        const userPublicKey = new PublicKey(swapRequest.userPublicKey);
        const inputMint = new PublicKey(swapRequest.quoteResponse.inputMint);
        const outputMint = new PublicKey(swapRequest.quoteResponse.outputMint);

        // TODO: override params...

        const [
            ataInstructions,
            decompressionInstructions,
            cleanupInstructions,
            jupSwapInstructionsPost,
        ] = await Promise.all([
            setupAtaInstructions(
                this.connection,
                userPublicKey,
                inputMint,
                outputMint,
                compressionParameters.compressionMode,
                swapRequest.skipUserAccountsRpcCalls,
            ),
            getDecompressionSetupInstructions(
                inputMint,
                requestParameters.swapRequest.quoteResponse.inAmount,
                this.connection,
                userPublicKey,
                compressionParameters.compressionMode,
                compressionParameters.outputStateTree ??
                    defaultTestStateTreeAccounts().merkleTree,
            ),
            getCleanupInstructions(
                compressionParameters.compressionMode,
                userPublicKey,
                inputMint,
                outputMint,
            ),
            super.swapInstructionsPost(requestParameters, initOverrides),
        ]);

        const {
            cleanupInstruction: _,
            setupInstructions: __,
            ...rest
        } = jupSwapInstructionsPost;

        return {
            ...rest,
            setupInstructions: [
                ...ataInstructions,
                ...decompressionInstructions,
            ].map(serializeInstruction),
            cleanupInstructions: cleanupInstructions.map(serializeInstruction),
            addressLookupTableAddresses: [
                ...jupSwapInstructionsPost.addressLookupTableAddresses,
                '9NYFyEqPkyXUhkerbGHXUXkvb4qpzeEdHuGpgbgpH1NJ',
            ],
        };
    }

    async swapInstructionsPostRawCompressed(
        requestParameters: SwapInstructionsPostRequest,
        initOverrides?: RequestInit | InitOverrideFunction,
    ): Promise<ApiResponse<SwapInstructionsResponse>> {
        return super.swapInstructionsPostRaw(requestParameters, initOverrides);
    }

    async swapPostCompressed(
        requestParameters: SwapPostRequest,
        initOverrides?: RequestInit | InitOverrideFunction,
    ): Promise<SwapResponse> {
        return super.swapPost(requestParameters, initOverrides);
    }

    async swapPostRawCompressed(
        requestParameters: SwapPostRequest,
        initOverrides?: RequestInit | InitOverrideFunction,
    ): Promise<ApiResponse<SwapResponse>> {
        return super.swapPostRaw(requestParameters, initOverrides);
    }
}
