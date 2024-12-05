export const LOOKUP_TABLE_ADDRESS =
    '9NYFyEqPkyXUhkerbGHXUXkvb4qpzeEdHuGpgbgpH1NJ';

export const ERROR_MESSAGES = {
    LEGACY_TRANSACTION: 'Legacy transactions are not supported',
    DYNAMIC_COMPUTE_UNIT_LIMIT: 'dynamicComputeUnitLimit is not supported yet.',
    PRIORITIZATION_FEE_LAMPORTS:
        'prioritizationFeeLamports is not supported yet. Use computeUnitPriceMicroLamports instead.',
    USE_TOKEN_LEDGER: 'useTokenLedger is not supported yet.',
    DESTINATION_TOKEN_ACCOUNT:
        'destinationTokenAccount is not supported when also compressing token output',
    ALLOW_OPTIMIZED_WRAPPED_SOL_TOKEN_ACCOUNT:
        'allowOptimizedWrappedSolTokenAccount must be false',
    EXACT_IN_ONLY: 'Only ExactIn swap mode is supported',
    WRAP_UNWRAP_SOL: 'wrapAndUnwrapSol must be true',
    SKIP_USER_ACCOUNTS_RPC_CALLS: 'skipUserAccountsRpcCalls must be false',
    UNSUPPORTED_COMPRESSION_MODE: (mode: string) =>
        `Compression mode: ${mode} not supported yet. Reach out to support@lightprotocol.com for an ETA.`,
} as const;

export class ValidationError extends Error {
    override name: 'ValidationError' = 'ValidationError';
    parameter: string;

    constructor(parameter: string, msg?: string) {
        super(msg ?? `Invalid parameter: ${parameter}`);
        this.parameter = parameter;
    }
}
