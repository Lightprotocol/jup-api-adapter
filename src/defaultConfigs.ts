import {
    Instruction,
    QuoteGetSwapModeEnum,
    SwapInstructionsResponse,
} from '@jup-ag/api';

export type CompressedSwapInstructionsResponse = Omit<
    SwapInstructionsResponse,
    'cleanupInstruction'
> & {
    cleanupInstructions: Array<Instruction>;
};

export interface DefaultQuoteGetRequestOverrides {
    swapMode: QuoteGetSwapModeEnum;
    restrictIntermediateTokens: boolean;
    onlyDirectRoutes: boolean;
    asLegacyTransaction: boolean;
    maxAccounts: number;
}
/**
 * Recommended overrides for the swap request. Manual overrides may lead to
 * unexpected behavior when used in conjunction with compressed instructions.
 */
export interface DefaultSwapPostRequestOverrides {
    wrapAndUnwrapSol: boolean;
    skipUserAccountsRpcCalls: boolean;
    asLegacyTransaction: boolean;
    allowOptimizedWrappedSolTokenAccount: boolean;
    useTokenLedger: boolean;
    destinationTokenAccount: string | undefined;
    dynamicComputeUnitLimit: boolean;
    prioritizationFeeLamports: boolean;
}

/**
 * Recommended overrides for the quote request. Manual overrides may lead to
 * unexpected behavior when used in conjunction with compressed instructions.
 */
export const defaultQuoteGetRequest: DefaultQuoteGetRequestOverrides = {
    maxAccounts: 64,
    onlyDirectRoutes: true,
    restrictIntermediateTokens: true,
    swapMode: QuoteGetSwapModeEnum.ExactIn,
    asLegacyTransaction: false,
};
/**
 * Recommended overrides for the swap request. Manual overrides may lead to
 * unexpected behavior when used in conjunction with compressed instructions.
 */
export const defaultSwapPostRequest: DefaultSwapPostRequestOverrides = {
    wrapAndUnwrapSol: false,
    skipUserAccountsRpcCalls: true,
    asLegacyTransaction: false,
    allowOptimizedWrappedSolTokenAccount: false,
    useTokenLedger: false,
    destinationTokenAccount: undefined,
    dynamicComputeUnitLimit: false,
    prioritizationFeeLamports: false,
};

/**
 * Specifies how token compression should be handled during swaps.
 *
 * If undefined, bypasses zk compression and uses the regular Jupiter API
 * directly.
 *
 * @property {string} DecompressInput - Decompress input token to ATA before
 * swap
 * @property {string} CompressOutput - Compress output token to ATA after swap
 * @property {string} DecompressAndCompress - Decompress input to ATA before
 * swap AND compress output to ATA after swap
 */
export enum TokenCompressionMode {
    DecompressInput = 'decompressInput',
    CompressOutput = 'compressOutput',
    DecompressAndCompress = 'decompressAndCompress',
}
