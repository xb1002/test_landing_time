import { Transaction, SystemProgram, Keypair,
    PublicKey, Connection,ComputeBudgetProgram
 } from '@solana/web3.js';
import { createLogger } from './logger.js';



// 
export interface CreateTransactionParams {
    payer: PublicKey,
    cu_num: number,
    cu_price: number,
    blockhash: string,
}
// 生成一笔随机交易
export function createTransaction(params: CreateTransactionParams): Transaction {
    let { payer, cu_num, cu_price, blockhash } = params;
    let transaction = new Transaction();
    // 设置cu
    let cu = ComputeBudgetProgram.setComputeUnitLimit({
        units: cu_num
    })
    transaction.add(cu);
    // 设置cu价格
    let cuPrice = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: cu_price
    })
    transaction.add(cuPrice);
    // 随机转账
    let randomPublicKey = Keypair.generate().publicKey;
    let ix = SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: randomPublicKey,
        lamports: 0,
    });
    transaction.add(ix);
    transaction.recentBlockhash = blockhash;
    return transaction;
}