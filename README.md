# Jupiter Compression SDK

A wrapper for @jup-ag/api that adds Compressed Token support.

## Installation

```bash
yarn add @lightprotocol/jup-api-adapter
```

## Usage

```typescript
import {
    createJupiterApiAdapterClient,
    TokenCompressionMode,
} from '@lightprotocol/jup-api-adapter';
import { Rpc } from '@lightprotocol/stateless.js';

// Init with RPC that supports compression
const RPC_URL = 'https://mainnet.helius-rpc.com?api-key=<your-api-key>';
const COMPRESSION_URL = RPC_URL;
const PROVER_URL = RPC_URL;
const connection = new Rpc(RPC_URL, COMPRESSION_URL, PROVER_URL);
const client = await createJupiterApiAdapterClient(connection);

// Get quote for compressed tokens
const quote = await client.quoteGetCompressed(
    {
        inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        outputMint: 'So11111111111111111111111111111111111111112',
        amount: 42,
    },
    TokenCompressionMode.DecompressInput,
);

// Get Swap TX
const swapTx = await client.swapPostCompressed(
    {
        swapRequest: {
            userPublicKey: 'your-pubkey',
            quoteResponse: quote,
        },
    },
    {
        compressionMode: TokenCompressionMode.DecompressInput,
    },
);

swapTx.sign(YOUR_KEYPAIR);
// send and confirm ...
```

## Overview

Extends `DefaultApi` class with endpoints:

- `quoteGetCompressed`
- `quoteGetRawCompressed`
- `swapInstructionsPostCompressed`
- `swapInstructionsPostRawCompressed`
- `swapPostCompressed`
- `swapPostRawCompressed`

## Constraints when using one of the compression endpoints

- `swapMode` must be `ExactIn`
- `wrapAndUnwrapSol` must be `true`
- `skipUserAccountsRpcCalls` must be `false`
- `asLegacyTransaction` must be `false`
- `useTokenLedger` must be `false`
- `allowOptimizedWrappedSolTokenAccount` must be `false`
- `dynamicComputeUnitLimit` must be `false`
- `prioritizationFeeLamports` not supported yet (use `computeUnitPriceMicroLamports` instead)
- `compressionMode` must be one of `DecompressInput`, `DecompressAndCompress`, `CompressOutput`.

- Instructions
    - ComputeBudgetInstructions are mutated to reflect higher cu usage. (PrioritizationFee lamports are not supported yet. Use computeUnitPriceMicroLamports instead.)
    - `addressLookupTableAddresses` is extended with `LIGHT_LUT`.
    - `setupInstructions` and `closeInstructions` are extended with
        - `getCreateAtaInstructions` (tokenIn, tokenOut)
        - `getDecompressionSetupInstructions` (tokenIn, tokenOut)
        - `getCleanupInstructions` (tokenIn, tokenOut)
