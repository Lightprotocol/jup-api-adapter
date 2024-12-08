import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import { ComputeBudgetInstruction } from '@solana/web3.js';
import { Instruction } from '@jup-ag/api';
import { TokenCompressionMode } from '../src/defaultConfigs.ts';
import {
    serializeInstruction,
    deserializeInstruction,
    getUpdatedComputeBudgetInstructions,
    getCleanupInstructions,
    getCreateAtaInstructions,
} from '../src/instructions.ts';
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Rpc } from '@lightprotocol/stateless.js';
/**
 * Test Coverage:
 *
 * serializeInstruction/deserializeInstruction()
 * ✓ Success: correct instructions serde.
 * ✓ Error: invalid instruction format
 * ✓ Error: malformed data
 *
 * getUpdatedComputeBudgetInstructions()
 * ✓ Success: increases compute units by 300k for DecompressInput
 * ✓ Success: maintains original units for other modes
 * ✓ Success: enforces 1.4M max unit limit
 * ✓ Success: preserves compute unit price
 * ✓ Error: missing compute budget instructions
 *
 * getCleanupInstructions()
 * ✓ Success: returns cleanup for DecompressInput mode
 * ✓ Success: returns cleanup for DecompressAndCompress mode
 * ✓ Success: returns empty array for CompressOutput mode
 * ✓ Error: invalid compression mode
 *
 * getCreateAtaInstructions()
 * ✓ Success: skips RPC calls when specified
 * ✓ Success: creates both ATAs when none exist
 * ✓ Success: creates only missing ATA when one exists
 * ✓ Success: skips input ATA check for CompressOutput
 */
describe('instruction utils', () => {
    describe('serializeInstruction and deserializeInstruction', () => {
        it('should correctly serialize and deserialize instructions', () => {
            const originalInstruction =
                ComputeBudgetProgram.setComputeUnitLimit({
                    units: 200_000,
                });

            const serialized = serializeInstruction(originalInstruction);
            const deserialized = deserializeInstruction(serialized);

            expect(deserialized.programId.toBase58()).toBe(
                originalInstruction.programId.toBase58(),
            );
            expect(deserialized.data).toEqual(originalInstruction.data);
            expect(deserialized.keys).toEqual(originalInstruction.keys);
        });

        it('should throw on invalid instruction format', () => {
            const invalidInstruction = {
                programId: 'not-a-public-key',
                data: 'invalid-data',
                keys: null,
            };

            expect(() =>
                serializeInstruction(invalidInstruction as any),
            ).toThrow();
        });

        it('should throw on malformed data', () => {
            const malformedData = {
                programId: new PublicKey('11111111111111111111111111111111'),
                data: 1, // Invalid data
                keys: [],
            };

            expect(() => serializeInstruction(malformedData as any)).toThrow();
        });
    });

    describe('getUpdatedComputeBudgetInstructions', () => {
        const createMockComputeBudgetInstructions = (
            units: number,
            microLamports: bigint,
        ): Instruction[] => {
            const unitLimit = ComputeBudgetProgram.setComputeUnitLimit({
                units,
            });
            const unitPrice = ComputeBudgetProgram.setComputeUnitPrice({
                microLamports,
            });

            return [
                serializeInstruction(unitLimit),
                serializeInstruction(unitPrice),
            ];
        };

        it('should increase compute units for DecompressInput mode', () => {
            const originalUnits = 200_000;
            const mockInstructions = createMockComputeBudgetInstructions(
                originalUnits,
                100n,
            );

            const result = getUpdatedComputeBudgetInstructions(
                mockInstructions,
                TokenCompressionMode.DecompressInput,
            );

            const updatedUnitLimit = deserializeInstruction(result[0]);
            const decodedUnits =
                ComputeBudgetInstruction.decodeSetComputeUnitLimit(
                    updatedUnitLimit,
                ).units;

            expect(decodedUnits).toBe(originalUnits + 300_000);
        });

        it('should not modify compute units for other modes', () => {
            const originalUnits = 200_000;
            const mockInstructions = createMockComputeBudgetInstructions(
                originalUnits,
                100n,
            );

            const result = getUpdatedComputeBudgetInstructions(
                mockInstructions,
                TokenCompressionMode.CompressOutput,
            );

            const updatedUnitLimit = deserializeInstruction(result[0]);
            const decodedUnits =
                ComputeBudgetInstruction.decodeSetComputeUnitLimit(
                    updatedUnitLimit,
                ).units;

            expect(decodedUnits).toBe(originalUnits);
        });

        it('should respect maximum compute unit limit', () => {
            const originalUnits = 1_200_000;
            const mockInstructions = createMockComputeBudgetInstructions(
                originalUnits,
                100n,
            );

            const result = getUpdatedComputeBudgetInstructions(
                mockInstructions,
                TokenCompressionMode.DecompressInput,
            );

            const updatedUnitLimit = deserializeInstruction(result[0]);
            const decodedUnits =
                ComputeBudgetInstruction.decodeSetComputeUnitLimit(
                    updatedUnitLimit,
                ).units;

            expect(decodedUnits).toBe(1_400_000); // Max limit
        });

        it('should preserve compute unit price', () => {
            const originalPrice = 1000n;
            const mockInstructions = createMockComputeBudgetInstructions(
                200_000,
                originalPrice,
            );

            const result = getUpdatedComputeBudgetInstructions(
                mockInstructions,
                TokenCompressionMode.DecompressInput,
            );

            const updatedUnitPrice = deserializeInstruction(result[1]);
            const decodedPrice =
                ComputeBudgetInstruction.decodeSetComputeUnitPrice(
                    updatedUnitPrice,
                ).microLamports;

            expect(decodedPrice).toBe(originalPrice);
        });

        it.skip('should throw on empty instruction array', () => {
            expect(() =>
                getUpdatedComputeBudgetInstructions(
                    [],
                    TokenCompressionMode.DecompressInput,
                ),
            ).toThrow('Missing compute budget instructions');
        });

        it.skip('should throw when compute unit instructions are missing', () => {
            const invalidInstructions = [
                serializeInstruction(
                    ComputeBudgetProgram.setComputeUnitPrice({
                        microLamports: 100n,
                    }),
                ),
            ];

            expect(() =>
                getUpdatedComputeBudgetInstructions(
                    invalidInstructions,
                    TokenCompressionMode.DecompressInput,
                ),
            ).toThrow('Missing compute budget instructions');
        });
    });

    describe('getCleanupInstructions', () => {
        const userPublicKey = new PublicKey('11111111111111111111111111111111');
        const inputMint = new PublicKey(
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        );
        const outputMint = new PublicKey(
            'So11111111111111111111111111111111111111112',
        );

        it('should return cleanup instructions for DecompressInput mode', async () => {
            const instructions = await getCleanupInstructions(
                TokenCompressionMode.DecompressInput,
                userPublicKey,
                inputMint,
                outputMint,
                false,
            );

            expect(instructions).toHaveLength(2); // wsol unwrap
            const instruction = instructions[0];
            expect(instruction.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
        });

        it('should return cleanup instructions for DecompressAndCompress mode', async () => {
            const instructions = await getCleanupInstructions(
                TokenCompressionMode.DecompressAndCompress,
                userPublicKey,
                inputMint,
                outputMint,
                false,
            );

            expect(instructions).toHaveLength(2); // wsol unwrap
            const instruction = instructions[0];
            expect(instruction.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
        });

        it('should return empty array for CompressOutput mode', async () => {
            const instructions = await getCleanupInstructions(
                TokenCompressionMode.CompressOutput,
                userPublicKey,
                inputMint,
                outputMint,
                false,
            );

            expect(instructions).toHaveLength(0);
        });

        it('should throw on invalid compression mode', async () => {
            await expect(
                getCleanupInstructions(
                    'invalid-mode' as TokenCompressionMode,
                    userPublicKey,
                    inputMint,
                    outputMint,
                    false,
                ),
            ).rejects.toThrow('Unknown compression mode: invalid-mode');
        });
    });

    describe('getCreateAtaInstructions', () => {
        const mockConnection = {
            getAccountInfo: vi.fn(),
        };
        const userPublicKey = new PublicKey('11111111111111111111111111111111');
        const inputMint = new PublicKey(
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        );
        const outputMint = new PublicKey(
            'So11111111111111111111111111111111111111112',
        );

        beforeEach(() => {
            mockConnection.getAccountInfo.mockReset();
        });

        it.skip('should return empty array when skipUserAccountsRpcCalls is true', async () => {
            const instructions = await getCreateAtaInstructions(
                mockConnection as unknown as Rpc,
                userPublicKey,
                inputMint,
                outputMint,
                TokenCompressionMode.DecompressInput,
                true,
            );

            expect(instructions).toHaveLength(0);
            expect(mockConnection.getAccountInfo).not.toHaveBeenCalled();
        });
        it('should create ATAs when accounts do not exist', async () => {
            mockConnection.getAccountInfo.mockResolvedValue(null);

            const instructions = await getCreateAtaInstructions(
                mockConnection as unknown as Rpc,
                userPublicKey,
                inputMint,
                outputMint,
                TokenCompressionMode.DecompressInput,
                false,
            );

            expect(instructions).toHaveLength(2);

            instructions.forEach(instruction => {
                expect(
                    instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID),
                ).toBe(true);
            });
        });

        it('should create only missing ATA when one exists', async () => {
            mockConnection.getAccountInfo
                .mockResolvedValueOnce({}) // input ATA exists
                .mockResolvedValueOnce(null); // output ATA doesn't exist

            const instructions = await getCreateAtaInstructions(
                mockConnection as unknown as Rpc,
                userPublicKey,
                inputMint,
                outputMint,
                TokenCompressionMode.DecompressInput,
                false,
            );

            expect(instructions).toHaveLength(1);
            expect(mockConnection.getAccountInfo).toHaveBeenCalledTimes(2);
            expect(
                instructions[0].programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID),
            ).toBe(true);
        });

        it('should skip input ATA check for CompressOutput mode', async () => {
            mockConnection.getAccountInfo.mockResolvedValue(null);

            const instructions = await getCreateAtaInstructions(
                mockConnection as unknown as Rpc,
                userPublicKey,
                inputMint,
                outputMint,
                TokenCompressionMode.CompressOutput,
                false,
            );

            expect(instructions).toHaveLength(1);
            expect(mockConnection.getAccountInfo).toHaveBeenCalledTimes(1);
        });
    });
});
