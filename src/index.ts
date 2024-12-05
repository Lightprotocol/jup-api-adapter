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
    defaultTestStateTreeAccounts,
    parseTokenLayoutWithIdl,
    Rpc,
} from '@lightprotocol/stateless.js';

/// Compresses full tokenOut (determined at runtime) from ata to owner.
const getCompressTokenOutInstruction = async (
    mint: PublicKey,
    owner: PublicKey,
    ata: PublicKey,
    outputStateTree: PublicKey,
) => {
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
) => {
    amount = bn(amount);

    // Get compressed token accounts with custom Token program. Therefore we
    // must parse in the client instead of using
    // getCompressedTokenAccountsByOwner.
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

    const ix = await CompressedTokenProgram.decompress({
        payer: owner,
        inputCompressedTokenAccounts: inputAccounts,
        toAddress: ata,
        amount,
        outputStateTree,
        recentInputStateRootIndices: proof.rootIndices,
        recentValidityProof: proof.compressedProof,
    });
    return ix;
};

/**
 * Wraps createJupiterApiClient
 */
async function createJupiterApiAdapterClient(
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

    private validateAndBuildQuoteGetParams(
        requestParameters: QuoteGetRequest,
    ): QuoteGetRequest {
        const {
            restrictIntermediateTokens,
            asLegacyTransaction,
            onlyDirectRoutes,
            maxAccounts,
            swapMode,
            ...rest
        } = requestParameters;

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

    private validateCompressionMode(compressionMode: TokenCompressionMode) {
        if (
            compressionMode !== TokenCompressionMode.DecompressInput
        ) {
            throw new Error(
                `Compression mode: ${compressionMode} not supported yet. Reach out to support@lightprotocol.com for an ETA.`,
            );
        }
    }

    // TODO: check if compressionMode is needed here long-term.
    async quoteGetCompressed(
        requestParameters: QuoteGetRequest,
        compressionMode: TokenCompressionMode,
        initOverrides?: RequestInit,
    ): Promise<QuoteResponse> {
        this.validateCompressionMode(compressionMode);
        const params = this.validateAndBuildQuoteGetParams(requestParameters);
        return super.quoteGet(params, initOverrides);
    }

    // TODO: check if compressionMode is needed here long-term.
    async quoteGetRawCompressed(
        requestParameters: QuoteGetRequest,
        compressionMode: TokenCompressionMode,
        initOverrides?: RequestInit | InitOverrideFunction,
    ): Promise<ApiResponse<QuoteResponse>> {
        this.validateCompressionMode(compressionMode);
        const params = this.validateAndBuildQuoteGetParams(requestParameters);
        return super.quoteGetRaw(params, initOverrides);
    }

    async swapInstructionsPostCompressed(
        requestParameters: SwapInstructionsPostRequest,
        compressionParameters: {
            compressionMode: TokenCompressionMode,
            outputStateTree?: PublicKey,
        },
        initOverrides?: RequestInit | InitOverrideFunction,
    ): Promise<Omit<SwapInstructionsResponse, 'cleanupInstruction'> & { cleanupInstructions: Array<TransactionInstruction> }> {
        /// type safety
        const { compressionMode, outputStateTree, ...rest } = requestParameters;
        const swapInstructionsPostRequest: SwapInstructionsPostRequest = rest;

        /// bypass zk compression
        if (compressionMode === undefined) {
            return super.swapInstructionsPost(
                swapInstructionsPostRequest,
                initOverrides,
            );
        }
        /// temp: only `decompressInput` supported
        this.validateCompressionMode(compressionMode);

        const { swapRequest } = swapInstructionsPostRequest;
        // parse params
        const userPublicKey = new PublicKey(swapRequest.userPublicKey);
        const inputMint = new PublicKey(swapRequest.quoteResponse.inputMint);
        const outputMint = new PublicKey(swapRequest.quoteResponse.outputMint);
        let setupInstructions: TransactionInstruction[] = [];
        let cleanupInstructions: TransactionInstruction[] = [];
        let addressLookupTableAddresses: PublicKey[] = [];
        const inputAta = await getAssociatedTokenAddress(
            inputMint,
            userPublicKey,
        );
        const outputAta = await getAssociatedTokenAddress(
            outputMint,
            userPublicKey,
        );

        /// Create ATAs if required.
        if (!swapRequest.skipUserAccountsRpcCalls) {
            // TODO: add documentation pointing out that inAta needs to be created by user if so

            // If in compression mode `CompressOutput`, the input ATA must already exist.
            if (compressionMode !== TokenCompressionMode.CompressOutput) {
                const inputAtaInfo =
                    await this.connection.getAccountInfo(inputAta);

                const createInputAtaIx = inputAtaInfo
                    ? null
                    : createAssociatedTokenAccountInstruction(
                          userPublicKey,
                          inputAta,
                          userPublicKey,
                          inputMint,
                      );

                if (createInputAtaIx) setupInstructions.push(createInputAtaIx);
            }

            const outputAtaInfo =
                await this.connection.getAccountInfo(outputAta);
            const createOutputAtaIx = outputAtaInfo
                ? null
                : createAssociatedTokenAccountInstruction(
                      userPublicKey,
                      outputAta,
                      userPublicKey,
                      outputMint,
                  );
            if (createOutputAtaIx) setupInstructions.push(createOutputAtaIx);
        }

        /// INPUT
        if (
            compressionMode === TokenCompressionMode.DecompressInput ||
            compressionMode === TokenCompressionMode.DecompressAndCompress
        ) {
            // decompress tokenIn
            const decompressTokenInIx = await getDecompressTokenInstruction(
                inputMint,
                bn(requestParameters.swapRequest.quoteResponse.inAmount),
                this.connection,
                userPublicKey,
                inputAta,
                TOKEN_PROGRAM_ID,
                defaultTestStateTreeAccounts().merkleTree,
            );
            setupInstructions.push(decompressTokenInIx);

            // close inputAta
            const closeInputAtaIx = createCloseAccountInstruction(
                inputAta,
                userPublicKey,
                userPublicKey,
            );
            cleanupInstructions.push(closeInputAtaIx);
        }

        if (
            compressionMode === TokenCompressionMode.CompressOutput ||
            compressionMode === TokenCompressionMode.DecompressAndCompress
        ) {
            // compress tokenOut
            const compressTokenOutIx = await getCompressTokenOutInstruction(
                outputMint,
                userPublicKey,
                outputAta,
                defaultTestStateTreeAccounts().merkleTree,
            );
            cleanupInstructions.push(compressTokenOutIx);

            // close outputAta
            const closeOutputAtaIx = createCloseAccountInstruction(
                outputAta,
                userPublicKey,
                userPublicKey,
            );
            cleanupInstructions.push(closeOutputAtaIx);
        }

        const jupSwapInstrutionsPost = await super.swapInstructionsPost(
            swapInstructionsPostRequest,
            initOverrides,
        );
        jupSwapInstrutionsPost.addressLookupTableAddresses.push(
            '9NYFyEqPkyXUhkerbGHXUXkvb4qpzeEdHuGpgbgpH1NJ',
        );
        jupSwapInstrutionsPost.cleanupInstruction = 

        // const extendedSetupInstructions = [
        //     ...setupInstructions,
        //     ...jupSwapInstrutionsPost.setupInstructions, // TODO: confirm existence
        // ];

        // const extendedCleanupInstructions = [
        //     ...cleanupInstructions,
        //     jupSwapInstrutionsPost.cleanupInstruction,
        // ];


        const allInstructions = 

        /// adds lightprotocol mainnet LUT address
        const extendedAddressLookupTableAddresses =
            jupSwapInstrutionsPost.addressLookupTableAddresses.push(
                '9NYFyEqPkyXUhkerbGHXUXkvb4qpzeEdHuGpgbgpH1NJ',
            );
        return jupSwapInstrutionsPost;
    }
    override swapInstructionsPostRaw(
        requestParameters: SwapInstructionsPostRequest,
        initOverrides?: RequestInit | InitOverrideFunction,
    ): Promise<ApiResponse<SwapInstructionsResponse>> {
        return super.swapInstructionsPostRaw(requestParameters, initOverrides);
    }
    override swapPost(
        requestParameters: SwapPostRequest,
        initOverrides?: RequestInit | InitOverrideFunction,
    ): Promise<SwapResponse> {
        return super.swapPost(requestParameters, initOverrides);
    }
    override swapPostRaw(
        requestParameters: SwapPostRequest,
        initOverrides?: RequestInit | InitOverrideFunction,
    ): Promise<ApiResponse<SwapResponse>> {
        return super.swapPostRaw(requestParameters, initOverrides);
    }
}
