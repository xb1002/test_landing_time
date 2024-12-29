import { Keypair, PublicKey, Connection, SystemProgram, Transaction, Signer, ComputeBudgetProgram } from "@solana/web3.js";
import fs from 'fs';
import bs58 from 'bs58';
import WebSocket from 'ws';
import "dotenv/config";
import { WebSocketClient } from './lib/ws.js';
import { createTransaction } from './lib/common.js';
import { createLogger } from "./lib/logger.js";

// 创建logger
const logger = createLogger({ service: "index" });

// 读取配置
const secretKey = process.env.SECRETKEY as string;
const rpc = process.env.RPC as string;
const wsRpc = process.env.WS_RPC || rpc.replace('https', 'wss');
const sendRpc = process.env.SEND_TRANSACTION_RPC || rpc;
const rate_limit = parseInt(process.env.RATE_LIMIT as string);
const tx_count = parseInt(process.env.TX_COUNT as string);
const node_retries = parseInt(process.env.NODE_RETRIES as string);
const cu_num = parseInt(process.env.CU_NUM as string);
const cu_price = parseInt(process.env.CU_PRICE as string);


const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 创建连接
const connection = new Connection(rpc, 'confirmed');
const sendConnection = new Connection(sendRpc, 'confirmed');

// 读取账户
const payer = Keypair.fromSecretKey(new Uint8Array(bs58.decode(secretKey)));
console.log('账户地址：', payer.publicKey.toBase58());

// ws连接，监听交易
let ws = new WebSocketClient(wsRpc);

// 获取blockhash
let { blockhash } = await connection.getLatestBlockhash();

let latestSlot = (await connection.getSlot('confirmed') as number);
setInterval(async () => {
    latestSlot += 1;
},420);
setInterval(async () => {
    try {
        let slot = (await connection.getSlot('confirmed') as number);
        if (slot > latestSlot) {
            latestSlot = slot;
        }
    }
    catch (err) {
        console.log(err);
    }
},5000);

interface data {
    start_slot: number;
    signature: string;
    land_slot?: number;
    slot_cost?: number;
}
let data: data[] = [];

for (let i = 0; i < tx_count; i++) {
    let tx = createTransaction({payer: payer.publicKey, cu_num, cu_price, blockhash});
    let slot = latestSlot;
    let signature = await sendConnection.sendTransaction(tx, [payer], {
        maxRetries: node_retries,
        skipPreflight: true
    });
    logger.info(`send tx ${signature} at slot ${slot}`);
    ws.subscribeSignature(signature);
    data.push({start_slot: slot, signature});
    await wait(1000/rate_limit);
}

ws.subscriptionData.map(async (item) => {
    while (item.status === 'processing') {
        await wait(50);
    }
    let slot = item.result?.slot;
    if (slot) {
        let index = data.findIndex((d) => d.signature === item.param);
        data[index].land_slot = slot;
        logger.info(`signature ${item.param} confirmed at slot ${slot}`);
    }
});

while (true) {
    if (ws.subscriptionData.every((item) => item.status !== 'processing')) {
        await wait(5*1000).then(() => {
            data = data.filter((item) => item.land_slot as number > 0);
            data.map((item) => {
                item.slot_cost = (item.land_slot as number)- item.start_slot;
            });
            let minCost = Math.min(...data.map((item) => item.slot_cost as number));
            let maxCost = Math.max(...data.map((item) => item.slot_cost as number));
            let avgCost = data.reduce((prev, curr) => prev + (curr.slot_cost as number), 0) / data.length;
            console.log('min cost slot：', minCost);
            console.log('max cost slot：', maxCost);
            console.log('avg cost slot：', avgCost);
            console.log(`landing rate ${data.length}/${tx_count}`);
            fs.writeFileSync('./data.json', JSON.stringify(data, null, 4));
            process.exit();
        });
    }
    await wait(50);
}