import {
    Instruction,
    QuoteGetRequest,
    QuoteGetSwapModeEnum,
    SwapInstructionsResponse,
    SwapPostRequest,
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
    skipUserAccountsRpcCalls: boolean;
    dynamicComputeUnitLimit: boolean;
    wrapAndUnwrapSol: boolean;
    allowOptimizedWrappedSolTokenAccount: boolean;
    asLegacyTransaction: boolean;
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
    skipUserAccountsRpcCalls: true,
    dynamicComputeUnitLimit: false,
    wrapAndUnwrapSol: false,
    allowOptimizedWrappedSolTokenAccount: false,
    asLegacyTransaction: false,
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

export interface CompressedQuoteGetRequest extends QuoteGetRequest {
    compressionMode?: TokenCompressionMode;
}

export interface CompressedSwapPostRequest extends SwapPostRequest {
    compressionMode?: TokenCompressionMode;
}
