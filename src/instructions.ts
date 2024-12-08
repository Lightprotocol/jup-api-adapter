import { Instruction } from '@jup-ag/api';
import {
    PublicKey,
    TransactionInstruction,
    ComputeBudgetProgram,
    ComputeBudgetInstruction,
} from '@solana/web3.js';
import { TokenCompressionMode } from './defaultConfigs.ts';
import {
    createAssociatedTokenAccountInstruction,
    createCloseAccountInstruction,
    getAssociatedTokenAddress,
} from '@solana/spl-token';
import {
    CompressedTokenProgram,
    CompressSplTokenAccountParams,
    selectMinCompressedTokenAccountsForTransfer,
} from '@lightprotocol/compressed-token';
import { bn, parseTokenLayoutWithIdl, Rpc } from '@lightprotocol/stateless.js';

const isInstanceOfInstruction = (instruction: any): boolean => {
    if (
        !instruction?.programId ||
        !(instruction.programId instanceof PublicKey)
    ) {
        throw new Error('Invalid program id');
    }
    if (!Array.isArray(instruction.keys)) {
        throw new Error('Invalid keys array');
    }
    if (!instruction.data) {
        throw new Error('Invalid instruction data');
    }
    return true;
};
export const serializeInstruction = (
    instruction: TransactionInstruction,
): Instruction => {
    isInstanceOfInstruction(instruction);

    return {
        programId: instruction.programId.toBase58(),
        accounts: instruction.keys.map(key => ({
            pubkey: key.pubkey.toBase58(),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
        })),
        data: Buffer.from(instruction.data).toString('base64'),
    };
};

export const deserializeInstruction = (
    instruction: Instruction,
): TransactionInstruction =>
    new TransactionInstruction({
        programId: new PublicKey(instruction.programId),
        keys: instruction.accounts.map(key => ({
            pubkey: new PublicKey(key.pubkey),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
        })),
        data: Buffer.from(instruction.data, 'base64'),
    });

// MAX CONCURRENCY
export const getCreateAtaInstructions = async (
    connection: Rpc,
    userPublicKey: PublicKey,
    inputMint: PublicKey,
    outputMint: PublicKey,
    compressionMode: TokenCompressionMode,
    skipUserAccountsRpcCalls: boolean,
): Promise<TransactionInstruction[]> => {
    // if (skipUserAccountsRpcCalls) return [];

    const instructions: TransactionInstruction[] = [];
    const [inputAta, outputAta] = await Promise.all([
        getAssociatedTokenAddress(inputMint, userPublicKey),
        getAssociatedTokenAddress(outputMint, userPublicKey),
    ]);

    const shouldCheckInputAta =
        compressionMode !== TokenCompressionMode.CompressOutput;

    // Get account info for ATAs
    const [inputAtaInfo, outputAtaInfo] = await Promise.all([
        shouldCheckInputAta ? connection.getAccountInfo(inputAta) : null,
        connection.getAccountInfo(outputAta),
    ]);

    // Create input ATA if needed and not compressing output
    if (shouldCheckInputAta && !inputAtaInfo) {
        instructions.push(
            createAssociatedTokenAccountInstruction(
                userPublicKey,
                inputAta,
                userPublicKey,
                inputMint,
            ),
        );
    }

    // Create output ATA if needed
    if (!outputAtaInfo) {
        instructions.push(
            createAssociatedTokenAccountInstruction(
                userPublicKey,
                outputAta,
                userPublicKey,
                outputMint,
            ),
        );
    }

    return instructions;
};

export const getDecompressionSetupInstructions = async (
    inputMint: PublicKey,
    inAmount: string,
    connection: Rpc,
    userPublicKey: PublicKey,
    compressionMode: TokenCompressionMode,
    outputStateTree: PublicKey,
): Promise<TransactionInstruction[]> => {
    if (
        compressionMode !== TokenCompressionMode.DecompressInput &&
        compressionMode !== TokenCompressionMode.DecompressAndCompress
    ) {
        return [];
    }

    const inputAta = await getAssociatedTokenAddress(inputMint, userPublicKey);
    return [
        await getDecompressTokenInstruction(
            inputMint,
            inAmount,
            connection,
            userPublicKey,
            inputAta,
            CompressedTokenProgram.programId,
            outputStateTree,
        ),
    ];
};

export const getCompressTokenOutInstruction = async (
    mint: PublicKey,
    owner: PublicKey,
    ata: PublicKey,
    outputStateTree: PublicKey,
): Promise<TransactionInstruction> => {
    const param: CompressSplTokenAccountParams = {
        feePayer: owner,
        mint,
        tokenAccount: ata,
        authority: owner,
        outputStateTree,
    };
    return await CompressedTokenProgram.compressSplTokenAccount(param);
};

const getDecompressTokenInstruction = async (
    mint: PublicKey,
    _amount: string,
    connection: Rpc,
    owner: PublicKey,
    ata: PublicKey,
    tokenProgramId: PublicKey,
    outputStateTree: PublicKey,
): Promise<TransactionInstruction> => {
    const amount = bn(_amount);

    const compressedTokenAccounts = (
        await connection.getCompressedTokenAccountsByOwner(owner, { mint })
    ).items;

    // const compressedTokenAccounts = (
    //     await connection.getCompressedAccountsByOwner(tokenProgramId)
    // ).items
    //     .map(acc => ({
    //         compressedAccount: acc,
    //         parsed: parseTokenLayoutWithIdl(acc, tokenProgramId)!,
    //     }))
    //     .filter(acc => acc.parsed.mint.equals(mint));

    const [inputAccounts] = selectMinCompressedTokenAccountsForTransfer(
        [compressedTokenAccounts[0]],
        amount,
    );
    const hashes = inputAccounts.map(account => account.compressedAccount.hash);

    const proof = await connection.getValidityProof(
        hashes.map(hash => bn(hash)),
    );

    return await CompressedTokenProgram.decompress({
        payer: owner,
        inputCompressedTokenAccounts: inputAccounts,
        toAddress: ata,
        amount,
        outputStateTree,
        recentInputStateRootIndices: proof.rootIndices,
        recentValidityProof: proof.compressedProof,
    });
};

export const getUpdatedComputeBudgetInstructions = (
    computeBudgetInstructions: Instruction[],
    compressionMode: TokenCompressionMode,
): Instruction[] => {
    const [unitLimitInstruction, unitPriceInstruction] =
        computeBudgetInstructions;

    // Handle unit limit
    const baseUnits = ComputeBudgetInstruction.decodeSetComputeUnitLimit(
        deserializeInstruction(unitLimitInstruction),
    ).units;

    const bufferAmount =
        compressionMode === TokenCompressionMode.DecompressInput ? 300_000 : 0;

    const newUnitLimit = ComputeBudgetProgram.setComputeUnitLimit({
        units: Math.min(baseUnits + bufferAmount, 1_400_000),
    });

    let newUnitPrice: TransactionInstruction;
    if (unitPriceInstruction) {
        // Handle unit price - preserve BigInt
        const priceParams = ComputeBudgetInstruction.decodeSetComputeUnitPrice(
            deserializeInstruction(unitPriceInstruction),
        );

        newUnitPrice = ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: priceParams.microLamports, // Keep as BigInt
        });
    }

    return [
        serializeInstruction(newUnitLimit),
        unitPriceInstruction ? serializeInstruction(newUnitPrice!) : undefined,
    ].filter((instr): instr is Instruction => instr !== undefined);
};

// TODO: add support for other compression modes
export const getCleanupInstructions = async (
    compressionMode: TokenCompressionMode,
    userPublicKey: PublicKey,
    inputMint: PublicKey,
    outputMint: PublicKey,
    _skipUserAccountsRpcCalls: boolean,
): Promise<TransactionInstruction[]> => {
    const instructions: TransactionInstruction[] = [];
    const [inputAta, outputAta] = await Promise.all([
        getAssociatedTokenAddress(inputMint, userPublicKey),
        getAssociatedTokenAddress(outputMint, userPublicKey),
    ]);

    if (
        compressionMode === TokenCompressionMode.DecompressInput ||
        compressionMode === TokenCompressionMode.DecompressAndCompress
    ) {
        instructions.push(
            createCloseAccountInstruction(
                inputAta,
                userPublicKey,
                userPublicKey,
            ),
        );
    } else if (compressionMode !== TokenCompressionMode.CompressOutput) {
        throw new Error(`Unknown compression mode: ${compressionMode}`);
    }
    return instructions;
};
