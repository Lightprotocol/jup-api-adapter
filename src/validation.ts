import {
    defaultSwapPostRequest,
    TokenCompressionMode,
} from './defaultConfigs.ts';
import { QuoteGetSwapModeEnum, SwapPostRequest } from '@jup-ag/api';
import { QuoteGetRequest } from '@jup-ag/api';
import { ERROR_MESSAGES, ValidationError } from './constants.ts';
import { defaultQuoteGetRequest } from './defaultConfigs.ts';

export function validateCompressionMode(mode: TokenCompressionMode): void {
    if (mode !== TokenCompressionMode.DecompressInput) {
        throw new ValidationError(
            'compressionMode',
            ERROR_MESSAGES.UNSUPPORTED_COMPRESSION_MODE(mode),
        );
    }
}
export function validateQuoteGetParams(
    params: QuoteGetRequest,
): QuoteGetRequest {
    const {
        restrictIntermediateTokens,
        asLegacyTransaction,
        onlyDirectRoutes,
        maxAccounts,
        swapMode,
        ...rest
    } = params;

    if (swapMode !== undefined && swapMode !== QuoteGetSwapModeEnum.ExactIn) {
        throw new ValidationError('swapMode', ERROR_MESSAGES.EXACT_IN_ONLY);
    }

    if (asLegacyTransaction === true) {
        throw new ValidationError(
            'asLegacyTransaction',
            ERROR_MESSAGES.LEGACY_TRANSACTION,
        );
    }

    return {
        ...rest,
        maxAccounts:
            maxAccounts !== undefined
                ? maxAccounts
                : defaultQuoteGetRequest.maxAccounts,
        onlyDirectRoutes:
            onlyDirectRoutes !== undefined
                ? onlyDirectRoutes
                : defaultQuoteGetRequest.onlyDirectRoutes,
        restrictIntermediateTokens:
            restrictIntermediateTokens !== undefined
                ? restrictIntermediateTokens
                : defaultQuoteGetRequest.restrictIntermediateTokens,
        swapMode: defaultQuoteGetRequest.swapMode,
        asLegacyTransaction: defaultQuoteGetRequest.asLegacyTransaction,
    };
}

export function validateSwapPostParams(
    params: SwapPostRequest,
    compressionMode: TokenCompressionMode,
): SwapPostRequest {
    const {
        wrapAndUnwrapSol,
        skipUserAccountsRpcCalls,
        asLegacyTransaction,
        allowOptimizedWrappedSolTokenAccount,
        useTokenLedger,
        destinationTokenAccount,
        dynamicComputeUnitLimit,
        prioritizationFeeLamports,
    } = params.swapRequest;
    // we always wrap/unwrap sol if its used
    if (wrapAndUnwrapSol !== undefined && !wrapAndUnwrapSol) {
        throw new ValidationError(
            'wrapAndUnwrapSol',
            ERROR_MESSAGES.WRAP_UNWRAP_SOL,
        );
    }
    if (skipUserAccountsRpcCalls !== undefined && skipUserAccountsRpcCalls) {
        throw new ValidationError(
            'skipUserAccountsRpcCalls',
            ERROR_MESSAGES.SKIP_USER_ACCOUNTS_RPC_CALLS,
        );
    }
    if (asLegacyTransaction !== undefined && asLegacyTransaction) {
        throw new ValidationError(
            'asLegacyTransaction',
            ERROR_MESSAGES.LEGACY_TRANSACTION,
        );
    }
    if (
        allowOptimizedWrappedSolTokenAccount !== undefined &&
        allowOptimizedWrappedSolTokenAccount
    ) {
        throw new ValidationError(
            'allowOptimizedWrappedSolTokenAccount',
            ERROR_MESSAGES.ALLOW_OPTIMIZED_WRAPPED_SOL_TOKEN_ACCOUNT,
        );
    }
    if (useTokenLedger !== undefined && useTokenLedger) {
        throw new ValidationError(
            'useTokenLedger',
            ERROR_MESSAGES.USE_TOKEN_LEDGER,
        );
    }
    if (
        destinationTokenAccount !== undefined &&
        compressionMode !== TokenCompressionMode.DecompressInput
    ) {
        throw new ValidationError(
            'destinationTokenAccount',
            ERROR_MESSAGES.DESTINATION_TOKEN_ACCOUNT,
        );
    }
    if (dynamicComputeUnitLimit !== undefined && dynamicComputeUnitLimit) {
        throw new ValidationError(
            'dynamicComputeUnitLimit',
            ERROR_MESSAGES.DYNAMIC_COMPUTE_UNIT_LIMIT,
        );
    }
    if (prioritizationFeeLamports !== undefined && prioritizationFeeLamports) {
        throw new ValidationError(
            'prioritizationFeeLamports',
            ERROR_MESSAGES.PRIORITIZATION_FEE_LAMPORTS,
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
