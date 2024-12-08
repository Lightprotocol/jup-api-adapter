import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    minify: true,
    external: [
        '@jup-ag/api',
        '@lightprotocol/compressed-token',
        '@lightprotocol/stateless.js',
        '@solana/spl-token',
        '@solana/web3.js',
        'bs58'
    ],
    treeshake: true,
    sourcemap: true,
});
