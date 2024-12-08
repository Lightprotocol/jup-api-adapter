# Jupiter API ZK Compression Adapter

A wrapper for @jup-ag/api that adds Compressed Token support.

## Installation

```bash
yarn add @lightprotocol/jup-api-adapter
```

## Usage

```typescript
import { VersionedTransaction } from '@solana/web3.js';
import { createRpc } from '@lightprotocol/stateless.js';
import { createJupiterApiAdapterClient, TokenCompressionMode } from '@lightprotocol/jup-api-adapter';

// Create RPC connection with compression support
const connection = createRpc(RPC_URL, COMPRESSION_URL, COMPRESSION_URL);

// Initialize Jupiter API Adapter client
const jupiterApi = await createJupiterApiAdapterClient(connection);

// Get quote
const quote = await jupiterApi.quoteGetCompressed({
    inputMint: INPUT_MINT.toBase58(),
    outputMint: OUTPUT_MINT.toBase58(),
    amount: AMOUNT,
    onlyDirectRoutes: true,
    slippageBps: 500,
}, TokenCompressionMode.DecompressInput);

// Get swap transaction
const swapResponse = await jupiterApi.swapPostCompressed({
    swapRequest: {
        userPublicKey: wallet.publicKey.toBase58(),
        quoteResponse: quote,
    }
}, { compressionMode: TokenCompressionMode.DecompressInput });


const tx = VersionedTransaction.deserialize(Buffer.from(swapResponse.swapTransaction, 'base64'));
tx.sign([wallet]);
// send ...

```

For more code examples, see [this repo](https://github.com/Lightprotocol/example-jupiter-swap-node/blob/main).


## Overview

Extends `DefaultApi` class with endpoints:

- `quoteGetCompressed`
- `quoteGetRawCompressed`
- `swapInstructionsPostCompressed`
- `swapInstructionsPostRawCompressed`
- `swapPostCompressed`
- `swapPostRawCompressed`

## Swap params for compression endpoints

- `swapMode` is `ExactIn`
- `wrapAndUnwrapSol` must be `true`
- `skipUserAccountsRpcCalls` must be `false`
- `asLegacyTransaction` must be `false`
- `useTokenLedger` must be `false`
- `allowOptimizedWrappedSolTokenAccount` must be `false`
- `dynamicComputeUnitLimit` must be `false`
- `prioritizationFeeLamports` not supported yet (use `computeUnitPriceMicroLamports` instead)

- Instructions
    - mutates `ComputeBudgetInstructions` to reflect higher cu usage.
    - extends `addressLookupTableAddresses` with a lookup table for [Light Protocol](https://www.zkcompression.com/developers/protocol-addresses-and-urls#lookup-tables).
    - extends `setupInstructions` and `closeInstructions` with
        - `getCreateAtaInstructions` (tokenIn, tokenOut)
        - `getDecompressionSetupInstructions` (tokenIn, tokenOut)
        - `getCleanupInstructions` (tokenIn, tokenOut)


## Notes
- This is in alpha. If you find bugs, report them on Discord or via [Telegram](https://t.me/swen_light)
- No safeguards added. Use at your own risk.

  
