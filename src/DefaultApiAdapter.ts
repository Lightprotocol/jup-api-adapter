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
} from '@jup-ag/api';
import {
    TransactionMessage,
    PublicKey,
    VersionedTransaction,
    AddressLookupTableAccount,
} from '@solana/web3.js';
import {
    TokenCompressionMode,
    CompressedSwapInstructionsResponse,
} from './defaultConfigs.ts';
import { defaultTestStateTreeAccounts, Rpc } from '@lightprotocol/stateless.js';
import { LOOKUP_TABLE_ADDRESS } from './constants.ts';
import {
    deserializeInstruction,
    getCleanupInstructions,
    getDecompressionSetupInstructions,
    getUpdatedComputeBudgetInstructions,
    serializeInstruction,
    getCreateAtaInstructions,
} from './instructions.ts';
import {
    validateCompressionMode,
    validateQuoteGetParams,
    validateSwapPostParams,
} from './validation.ts';

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
            getCreateAtaInstructions(
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
        computeBudgetInstructions: getUpdatedComputeBudgetInstructions(
            rest.computeBudgetInstructions,
            compressionParameters.compressionMode,
        ),
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
): Promise<DefaultApiAdapter> {
    return new DefaultApiAdapter(new Configuration(config), connection);
}

export class DefaultApiAdapter extends DefaultApi {
    private connection: Rpc;
    static readonly LIGHT_LUT = LOOKUP_TABLE_ADDRESS;

    constructor(config: Configuration, connection: Rpc) {
        super(config);
        this.connection = connection;
    }

    async quoteGetCompressed(
        requestParameters: QuoteGetRequest,
        compressionMode: TokenCompressionMode,
        initOverrides?: RequestInit,
    ): Promise<QuoteResponse> {
        validateCompressionMode(compressionMode);
        const params = validateQuoteGetParams(requestParameters);
        return super.quoteGet(params, initOverrides);
    }

    async quoteGetRawCompressed(
        requestParameters: QuoteGetRequest,
        compressionMode: TokenCompressionMode,
        initOverrides?: RequestInit | InitOverrideFunction,
    ): Promise<ApiResponse<QuoteResponse>> {
        validateCompressionMode(compressionMode);
        const params = validateQuoteGetParams(requestParameters);
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
        validateCompressionMode(compressionParameters.compressionMode);
        const validatedRequestParams = validateSwapPostParams(
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
        validateCompressionMode(compressionParameters.compressionMode);
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
        validateCompressionMode(compressionParameters.compressionMode);
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
