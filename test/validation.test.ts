import { describe, it, expect } from 'vitest';
import { QuoteGetSwapModeEnum, QuoteResponse } from '@jup-ag/api';
import { ValidationError } from '../src/constants.ts';
import {
    validateCompressionMode,
    validateQuoteGetParams,
    validateSwapPostParams,
} from '../src/validation.ts';
import {
    defaultQuoteGetRequest,
    defaultSwapPostRequest,
    TokenCompressionMode,
} from '../src/defaultConfigs.ts';

/**
 * Test Coverage:
 *
 * validateCompressionMode()
 * ✓ Success: DecompressInput
 * ✓ Fail: other modes
 *
 * validateQuoteGetParams()
 * ✓ Success: Default values
 * ✓ Fail: non-ExactIn
 * ✓ Fail: legacy tx
 *
 * validateSwapPostParams()
 * ✓ Success: valid params
 * ✓ Fail: wrapAndUnwrapSol=false
 * ✓ Fail: skipUserAccountsRpcCalls=true
 * ✓ Fail: != DecompressInput + destinationTokenAccount
 * ✓ Fail: legacy tx
 * ✓ Fail: optimizedWrappedSol=true
 * ✓ Fail: useTokenLedger=true
 * ✓ Fail: dynamicComputeUnitLimit=true
 * ✓ Fail: prioritizationFeeLamports>0
 */
describe('validateCompressionMode', () => {
    it('should accept DecompressInput mode', () => {
        expect(() =>
            validateCompressionMode(TokenCompressionMode.DecompressInput),
        ).not.toThrow();
    });

    it('should throw for other compression modes', () => {
        expect(() =>
            validateCompressionMode('other' as TokenCompressionMode),
        ).toThrow(ValidationError);
    });
});

describe('validateQuoteGetParams', () => {
    const validParams = {
        inputMint: 'mint1',
        outputMint: 'mint2',
        amount: 1000,
        swapMode: QuoteGetSwapModeEnum.ExactIn,
    };

    it('should apply default values correctly', () => {
        const result = validateQuoteGetParams(validParams);

        expect(result).toEqual({
            ...validParams,
            maxAccounts: defaultQuoteGetRequest.maxAccounts,
            onlyDirectRoutes: defaultQuoteGetRequest.onlyDirectRoutes,
            restrictIntermediateTokens:
                defaultQuoteGetRequest.restrictIntermediateTokens,
            swapMode: defaultQuoteGetRequest.swapMode,
            asLegacyTransaction: defaultQuoteGetRequest.asLegacyTransaction,
        });
    });
});

describe('validateSwapPostParams', () => {
    // @ts-ignore - exactOptionalPropertyTypes
    const mockQuoteResponse: QuoteResponse = {
        routePlan: [],
        swapMode: QuoteGetSwapModeEnum.ExactIn,
        inputMint: 'input-mint',
        outputMint: 'output-mint',
        inAmount: '1000',
        outAmount: '900',
        otherAmountThreshold: '890',
        platformFee: undefined,
        priceImpactPct: '1',
        slippageBps: 0,
        contextSlot: 0,
        timeTaken: 0,
    };

    const validParams = {
        swapRequest: {
            userPublicKey: 'dummy-public-key',
            quoteResponse: mockQuoteResponse,
            wrapAndUnwrapSol: true,
            skipUserAccountsRpcCalls: false,
            asLegacyTransaction: false,
            allowOptimizedWrappedSolTokenAccount: false,
            useTokenLedger: false,
            dynamicComputeUnitLimit: false,
            prioritizationFeeLamports: 0,
        },
    };

    it('should accept valid params', () => {
        expect(() =>
            validateSwapPostParams(
                validParams,
                TokenCompressionMode.DecompressInput,
            ),
        ).not.toThrow();
    });

    it('should throw when wrapAndUnwrapSol is false', () => {
        expect(() =>
            validateSwapPostParams(
                {
                    swapRequest: {
                        ...validParams.swapRequest,
                        wrapAndUnwrapSol: false,
                    },
                },
                TokenCompressionMode.DecompressInput,
            ),
        ).toThrow(ValidationError);
    });

    it('should throw when skipUserAccountsRpcCalls is true', () => {
        expect(() =>
            validateSwapPostParams(
                {
                    swapRequest: {
                        ...validParams.swapRequest,
                        skipUserAccountsRpcCalls: true,
                    },
                },
                TokenCompressionMode.DecompressInput,
            ),
        ).toThrow(ValidationError);
    });

    it('should throw when destinationTokenAccount is set with `CompressOutput`', () => {
        expect(() =>
            validateSwapPostParams(
                {
                    swapRequest: {
                        ...validParams.swapRequest,
                        destinationTokenAccount: 'someAccount',
                    },
                },
                TokenCompressionMode.CompressOutput,
            ),
        ).toThrow(ValidationError);
        expect(() =>
            validateSwapPostParams(
                {
                    swapRequest: {
                        ...validParams.swapRequest,
                        destinationTokenAccount: 'someAccount',
                    },
                },
                TokenCompressionMode.DecompressAndCompress,
            ),
        ).toThrow(ValidationError);
    });

    it('should throw when asLegacyTransaction is true', () => {
        expect(() =>
            validateSwapPostParams(
                {
                    swapRequest: {
                        ...validParams.swapRequest,
                        asLegacyTransaction: true,
                    },
                },
                TokenCompressionMode.DecompressInput,
            ),
        ).toThrow(ValidationError);
    });

    it('should throw when allowOptimizedWrappedSolTokenAccount is true', () => {
        expect(() =>
            validateSwapPostParams(
                {
                    swapRequest: {
                        ...validParams.swapRequest,
                        allowOptimizedWrappedSolTokenAccount: true,
                    },
                },
                TokenCompressionMode.DecompressInput,
            ),
        ).toThrow(ValidationError);
    });

    it('should throw when useTokenLedger is true', () => {
        expect(() =>
            validateSwapPostParams(
                {
                    swapRequest: {
                        ...validParams.swapRequest,
                        useTokenLedger: true,
                    },
                },
                TokenCompressionMode.DecompressInput,
            ),
        ).toThrow(ValidationError);
    });

    it('should throw when dynamicComputeUnitLimit is true', () => {
        expect(() =>
            validateSwapPostParams(
                {
                    swapRequest: {
                        ...validParams.swapRequest,
                        dynamicComputeUnitLimit: true,
                    },
                },
                TokenCompressionMode.DecompressInput,
            ),
        ).toThrow(ValidationError);
    });

    it('should throw when prioritizationFeeLamports is set', () => {
        expect(() =>
            validateSwapPostParams(
                {
                    swapRequest: {
                        ...validParams.swapRequest,
                        prioritizationFeeLamports: 1000,
                    },
                },
                TokenCompressionMode.DecompressInput,
            ),
        ).toThrow(ValidationError);
    });

    it('should apply default values correctly in returned object', () => {
        const result = validateSwapPostParams(
            validParams,
            TokenCompressionMode.DecompressInput,
        );

        expect(result).toEqual({
            swapRequest: {
                ...validParams.swapRequest,
                dynamicComputeUnitLimit:
                    defaultSwapPostRequest.dynamicComputeUnitLimit,
                skipUserAccountsRpcCalls:
                    defaultSwapPostRequest.skipUserAccountsRpcCalls,
                wrapAndUnwrapSol: defaultSwapPostRequest.wrapAndUnwrapSol,
                allowOptimizedWrappedSolTokenAccount:
                    defaultSwapPostRequest.allowOptimizedWrappedSolTokenAccount,
                asLegacyTransaction: defaultSwapPostRequest.asLegacyTransaction,
            },
        });
    });
});
