import {
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
    Instruction,
} from '@jup-ag/api';
import {
    TransactionMessage,
    PublicKey,
    TransactionInstruction,
    VersionedTransaction,
    AddressLookupTableAccount,
} from '@solana/web3.js';
import {
    defaultQuoteGetRequest,
    TokenCompressionMode,
    CompressedSwapInstructionsResponse,
    defaultSwapPostRequest,
    defaultSwapPostRequestForwarded,
} from './defaultConfigs.ts';
import {
    createAssociatedTokenAccountInstruction,
    createCloseAccountInstruction,
    getAssociatedTokenAddress,
    TOKEN_PROGRAM_ID,
    createWrappedNativeAccount,
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
import {
    LOOKUP_TABLE_ADDRESS,
    ERROR_MESSAGES,
    ValidationError,
} from './constants.ts';

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

// MAX CONCURRENCY
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

    const shouldCheckInputAta =
        compressionMode !== TokenCompressionMode.CompressOutput;

    // Get account info for ATAs
    const [inputAtaInfo, outputAtaInfo] = await Promise.all([
        shouldCheckInputAta ? connection.getAccountInfo(inputAta) : null,
        connection.getAccountInfo(outputAta),
    ]);

    // Create input ATA if needed and not compressing output
    if (shouldCheckInputAta && !inputAtaInfo) {
        instructions.push(
            createAssociatedTokenAccountInstruction(
                userPublicKey,
                inputAta,
                userPublicKey,
                inputMint,
            ),
        );
    }

    // Create output ATA if needed
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
    amount: string,
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
    skipUserAccountsRpcCalls: boolean,
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

async function processSwapInstructionsPostCompressed(
    requestParameters: SwapInstructionsPostRequest,
    compressionParameters: {
        compressionMode: TokenCompressionMode;
        outputStateTree?: PublicKey;
    },
    jupSwapInstructionsPost: SwapInstructionsResponse,
    connection: Rpc,
): Promise<CompressedSwapInstructionsResponse> {
    const { swapRequest } = requestParameters;
    const userPublicKey = new PublicKey(swapRequest.userPublicKey);
    const inputMint = new PublicKey(swapRequest.quoteResponse.inputMint);
    const outputMint = new PublicKey(swapRequest.quoteResponse.outputMint);

    const [ataInstructions, decompressionInstructions, cleanupInstructions] =
        await Promise.all([
            setupAtaInstructions(
                connection,
                userPublicKey,
                inputMint,
                outputMint,
                compressionParameters.compressionMode,
                requestParameters.swapRequest.skipUserAccountsRpcCalls!,
            ),
            getDecompressionSetupInstructions(
                inputMint,
                requestParameters.swapRequest.quoteResponse.inAmount,
                connection,
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
                requestParameters.swapRequest.skipUserAccountsRpcCalls!,
            ),
        ]);

    const {
        cleanupInstruction: _,
        setupInstructions: __,
        ...rest
    } = jupSwapInstructionsPost;

    return {
        ...rest,
        computeBudgetInstructions: [],
        setupInstructions: [
            ...ataInstructions,
            ...decompressionInstructions,
        ].map(serializeInstruction),
        cleanupInstructions: cleanupInstructions.map(serializeInstruction),
        addressLookupTableAddresses: [
            ...jupSwapInstructionsPost.addressLookupTableAddresses,
            DefaultApiAdapter.LIGHT_LUT,
        ],
    };
}

export async function createJupiterApiAdapterClient(
    connection: Rpc,
    config?: ConfigurationParameters,
): Promise<DefaultApi> {
    return new DefaultApiAdapter(new Configuration(config), connection);
}

export class DefaultApiAdapter extends DefaultApi {
    private connection: Rpc;
    static readonly LIGHT_LUT = LOOKUP_TABLE_ADDRESS;

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
            throw new ValidationError('swapMode', ERROR_MESSAGES.EXACT_IN_ONLY);
        }

        if (asLegacyTransaction) {
            throw new ValidationError(
                'asLegacyTransaction',
                ERROR_MESSAGES.LEGACY_TRANSACTION,
            );
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

    private validateSwapPostParams(
        params: SwapPostRequest | SwapInstructionsPostRequest,
        compressionMode: TokenCompressionMode,
    ): SwapPostRequest {
        // we always wrap/unwrap sol if its used
        if (!params.swapRequest.wrapAndUnwrapSol) {
            throw new ValidationError(
                'wrapAndUnwrapSol',
                ERROR_MESSAGES.WRAP_UNWRAP_SOL,
            );
        }
        if (params.swapRequest.skipUserAccountsRpcCalls) {
            throw new ValidationError(
                'skipUserAccountsRpcCalls',
                ERROR_MESSAGES.SKIP_USER_ACCOUNTS_RPC_CALLS,
            );
        }
        if (params.swapRequest.asLegacyTransaction) {
            throw new ValidationError(
                'asLegacyTransaction',
                ERROR_MESSAGES.LEGACY_TRANSACTION,
            );
        }
        if (params.swapRequest.allowOptimizedWrappedSolTokenAccount) {
            throw new ValidationError(
                'allowOptimizedWrappedSolTokenAccount',
                ERROR_MESSAGES.ALLOW_OPTIMIZED_WRAPPED_SOL_TOKEN_ACCOUNT,
            );
        }
        if (params.swapRequest.useTokenLedger) {
            throw new ValidationError(
                'useTokenLedger',
                ERROR_MESSAGES.USE_TOKEN_LEDGER,
            );
        }
        if (
            params.swapRequest.destinationTokenAccount &&
            compressionMode !== TokenCompressionMode.DecompressInput
        ) {
            throw new ValidationError(
                'destinationTokenAccount',
                ERROR_MESSAGES.DESTINATION_TOKEN_ACCOUNT,
            );
        }
        return {
            swapRequest: {
                ...params.swapRequest,
                dynamicComputeUnitLimit:
                    params.swapRequest.dynamicComputeUnitLimit ??
                    defaultSwapPostRequest.dynamicComputeUnitLimit,
                // must be enforced
                skipUserAccountsRpcCalls:
                    defaultSwapPostRequest.skipUserAccountsRpcCalls,
                wrapAndUnwrapSol: defaultSwapPostRequest.wrapAndUnwrapSol,
                allowOptimizedWrappedSolTokenAccount:
                    defaultSwapPostRequest.allowOptimizedWrappedSolTokenAccount,
                asLegacyTransaction: defaultSwapPostRequest.asLegacyTransaction,
            },
        };
    }

    private validateCompressionMode(mode: TokenCompressionMode): void {
        if (mode !== TokenCompressionMode.DecompressInput) {
            throw new ValidationError(
                'compressionMode',
                ERROR_MESSAGES.UNSUPPORTED_COMPRESSION_MODE(mode),
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
    ): Promise<CompressedSwapInstructionsResponse> {
        this.validateCompressionMode(compressionParameters.compressionMode);
        const validatedRequestParams = this.validateSwapPostParams(
            requestParameters,
            compressionParameters.compressionMode,
        );

        const jupSwapInstructionsPost = await super.swapInstructionsPost(
            validatedRequestParams,
            initOverrides,
        );
        return processSwapInstructionsPostCompressed(
            validatedRequestParams,
            compressionParameters,
            jupSwapInstructionsPost,
            this.connection,
        );
    }

    async swapInstructionsPostRawCompressed(
        requestParameters: SwapInstructionsPostRequest,
        compressionParameters: {
            compressionMode: TokenCompressionMode;
            outputStateTree?: PublicKey;
        },
        initOverrides?: RequestInit | InitOverrideFunction,
    ): Promise<ApiResponse<CompressedSwapInstructionsResponse>> {
        this.validateCompressionMode(compressionParameters.compressionMode);
        const response = await super.swapInstructionsPostRaw(
            requestParameters,
            initOverrides,
        );
        const processedResponse = await processSwapInstructionsPostCompressed(
            requestParameters,
            compressionParameters,
            await response.value(),
            this.connection,
        );
        return {
            raw: response.raw,
            value: () => Promise.resolve(processedResponse),
        };
    }

    async swapPostCompressed(
        requestParameters: SwapPostRequest,
        compressionParameters: {
            compressionMode: TokenCompressionMode;
            outputStateTree?: PublicKey;
        },
        initOverrides?: RequestInit | InitOverrideFunction,
    ): Promise<SwapResponse> {
        const [jupiterSwapResponse, compressedInstructions] = await Promise.all(
            [
                super.swapPost(requestParameters, initOverrides),
                this.swapInstructionsPostCompressed(requestParameters, {
                    compressionMode: compressionParameters.compressionMode,
                    outputStateTree:
                        compressionParameters.outputStateTree ??
                        defaultTestStateTreeAccounts().merkleTree,
                }),
            ],
        );

        return processSwapPostCompressed(
            requestParameters,
            jupiterSwapResponse,
            compressedInstructions,
            this.connection,
        );
    }

    async swapPostRawCompressed(
        requestParameters: SwapPostRequest,
        compressionParameters: {
            compressionMode: TokenCompressionMode;
            outputStateTree?: PublicKey;
        },
        initOverrides?: RequestInit | InitOverrideFunction,
    ): Promise<ApiResponse<SwapResponse>> {
        this.validateCompressionMode(compressionParameters.compressionMode);
        const [response, compressedInstructions] = await Promise.all([
            super.swapPostRaw(requestParameters, initOverrides),
            this.swapInstructionsPostCompressed(
                requestParameters,
                compressionParameters,
            ),
        ]);

        const processedResponse = await processSwapPostCompressed(
            requestParameters,
            await response.value(),
            compressedInstructions,
            this.connection,
        );

        return {
            raw: response.raw,
            value: () => Promise.resolve(processedResponse),
        };
    }
}

const getAddressLookupTableAccounts = async (
    keys: string[],
    connection: Rpc,
): Promise<AddressLookupTableAccount[]> => {
    const addressLookupTableAccountInfos =
        await connection.getMultipleAccountsInfo(
            keys.map(key => new PublicKey(key)),
        );

    return addressLookupTableAccountInfos.reduce((acc, accountInfo, index) => {
        const addressLookupTableAddress = keys[index];
        if (accountInfo) {
            const addressLookupTableAccount = new AddressLookupTableAccount({
                key: new PublicKey(addressLookupTableAddress),
                state: AddressLookupTableAccount.deserialize(accountInfo.data),
            });
            acc.push(addressLookupTableAccount);
        }

        return acc;
    }, new Array<AddressLookupTableAccount>());
};

async function processSwapPostCompressed(
    requestParameters: SwapPostRequest,
    jupiterSwapResponse: SwapResponse,
    compressedInstructions: CompressedSwapInstructionsResponse,
    connection: Rpc,
): Promise<SwapResponse> {
    const {
        computeBudgetInstructions,
        setupInstructions,
        swapInstruction,
        cleanupInstructions,
        addressLookupTableAddresses,
    } = compressedInstructions;

    const instructions = [
        ...computeBudgetInstructions.map(deserializeInstruction),
        ...setupInstructions.map(deserializeInstruction),
        deserializeInstruction(swapInstruction),
        ...cleanupInstructions.map(deserializeInstruction),
    ];

    const lookupTables = await getAddressLookupTableAccounts(
        addressLookupTableAddresses,
        connection,
    );

    const messageV0 = new TransactionMessage({
        payerKey: new PublicKey(requestParameters.swapRequest.userPublicKey),
        recentBlockhash: VersionedTransaction.deserialize(
            Buffer.from(jupiterSwapResponse.swapTransaction, 'base64'),
        ).message.recentBlockhash,
        instructions,
    }).compileToV0Message(lookupTables);

    return {
        ...jupiterSwapResponse,
        swapTransaction: Buffer.from(
            new VersionedTransaction(messageV0).serialize(),
        ).toString('base64'),
    };
}
