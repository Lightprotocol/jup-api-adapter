# Jupiter Compression SDK

A wrapper for @jup-ag/api that adds Compressed Token support.

## Installation

```bash
yarn add @lightprotocol/jup-api-adapter
```

## Overview

- Forwards all calls to `DefaultApi` from @jup-ag/api, so you can use the regular endpoints for the same behavior.

- Extends `DefaultApi` class from @jup-ag/api with `DefaultApiAdapter` with additional compression-specific methods:

    - `quoteGetCompressed`
    - `quoteGetRawCompressed`
    - `swapInstructionsPostCompressed`
    - `swapInstructionsPostRawCompressed`
    - `swapPostCompressed`
    - `swapPostRawCompressed`

- Adds compression-specific validation and instructions

- Key Constraints (from validation.ts)

    - `swapMode` must be `ExactIn`
    - `asLegacyTransaction` must be `false`
    - `wrapAndUnwrapSol` is always`true`
    - `skipUserAccountsRpcCalls` is always `false`.
    - `useTokenLedger` is always `false`.

- Instructions
    - ComputeBudgetInstructions are mutated to reflect higher cu usage. (PrioritizationFee lamports are not supported yet. Use computeUnitPriceMicroLamports instead.)
    - `addressLookupTableAddresses` is extended with `LIGHT_LUT`.
    - `setupInstructions` and `closeInstructions` are extended with
        - `getCreateAtaInstructions` (tokenIn, tokenOut)
        - `getDecompressionSetupInstructions` (tokenIn, tokenOut)
        - `getCleanupInstructions` (tokenIn, tokenOut)
          ... depending on the selected `compressionMode`.
