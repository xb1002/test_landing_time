import WebSocket from 'ws';
import { createLogger } from './logger.js';
import { commitment,enableReceivedNotification,maxSubscriptionTime } from '../config.js';

// 创建logger
const logger = createLogger({ service: "ws" });

// type
export type SubscribeMethods = 'signatureSubscribe';
export type SubscribeNotificationMethods = 'signatureNotification';
export type UnscribeMethods = 'signatureUnsubscribe';
export type Status = "processing" | "done" | "timeout" | "error";

// 参数 interface
// 取消订阅是通用的
export interface UnscribeParams {
    jsonrpc:"2.0", //jsonrpc版本
    id:number, // 会话id
    method:UnscribeMethods, // unscribe方法
    params:[number] // 订阅id
}
export interface GeneralSubscribeParams {
    jsonrpc:"2.0", //jsonrpc版本
    id:number, // 会话id
    method:SubscribeMethods, // 订阅方法
    params:any[] // 订阅参数
}
export interface SignatureSubscribeParams extends GeneralSubscribeParams {
    params:[
        string, {
        commitment?: string,
        enableReceivedNotification?: boolean
    }]
}
function getUnscribeParams(id:number, method:UnscribeMethods, subscriptionId:number):UnscribeParams {
    return {
        jsonrpc:"2.0",
        id:id,
        method:method,
        params:[subscriptionId]
    }
}
function getSignatureSubscribeParams(id:number, method:SubscribeMethods,signature:string):SignatureSubscribeParams {
    return {
        jsonrpc:"2.0",
        id:id,
        method:method,
        params:[
            signature,
            {
                "commitment": commitment || "confirmed",
                "enableReceivedNotification": enableReceivedNotification || false,
            }
        ]
    }
}


// 结果 interface
export interface SignatureSubscribeResult {
    slot: number,
    err: any
}
export type SubscriptionDataItemResult = SignatureSubscribeResult;

//
export const subscribeMethodToUnsubscribeMethod = {
    'signatureSubscribe': 'signatureUnsubscribe'
}


export interface SubscriptionDataItem {
    id: number, // 递增id
    method: SubscribeMethods, // 订阅方法
    param: any, // 如果是signatureSubscribe，param为signature，如果是accountSubscribe，param为address
    status: Status, // 订阅状态
    startTime: number,//单位为ms
    maxSubscriptionTime: number,//单位为ms
    subscriptionId?: number,
    result?: SubscriptionDataItemResult
}
export class WebSocketClient {
    private ws: WebSocket;
    private wsUrl: string;
    public subscriptionData: SubscriptionDataItem[] = [];
    private id: number = 0;

    constructor(wsUrl: string) {
        this.wsUrl = wsUrl;
        this.ws = new WebSocket(this.wsUrl);
        this.init();
        setInterval(() => {
            this.processInvalidSubscriptionData();
        }, 30000);
    }

    async wait(time: number) {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(void 0);
            }, time);
        });
    }

    async init() {
        await this.waitForConnection();
        await this.setupWebSocketHandlers();
        await this.processInvalidSubscriptionData();
    }

    async waitForConnection() {
        while (this.ws.readyState !== WebSocket.OPEN) {
            await this.wait(1);
        }
        logger.debug('ws connected');
    }

    async setupWebSocketHandlers() {
        this.ws.on('open', () => {
            logger.debug('ws connected');
        });

        this.ws.on('message', (data) => {
            this.handleMessages(data as string);
        });

        this.ws.on('close', () => {
            logger.debug('ws closed');
            this.wait(5000).then(() => {
                logger.debug('ws try to reconnect');
                this.ws = new WebSocket(this.wsUrl);
                this.init();
                this.reSubscribe(); //恢复之前的订阅
            });
        });

        this.ws.on('error', (err) => {
            logger.error('ws error', err);
            this.ws.close();
        });
    }

    handleMessages(data: string) {
        logger.debug(`receive message: ${JSON.stringify(data, null, 2)}`);
        try {
            let res = JSON.parse(data);
            if (!res.method) {
                if (res.result === true || res.result === false) {
                    this.handleUnsubscribe(res); // 处理取消订阅
                } else {
                    this.handleSubscriptionId(res); // 配置订阅id
                }
            }
            if (res.method === 'signatureNotification') {
                this.handleSignatureNotification(res);
            }
        } catch (err) {
            logger.error('handleMessages error:', err);
        }
    }

    handleSubscriptionId(data: any) {
        logger.debug(`subscriptionId: ${JSON.stringify(data, null, 2)}`);
        try {
            let index = this.subscriptionData.findIndex((item) => item.id === data.id);
            if (index !== -1) {
                this.subscriptionData[index].subscriptionId = data.result;
            }
        } catch (err) {
            logger.error('handleSubscriptionId error:', err);
        }
    }

    handleUnsubscribe(data: any) {
        try {
            let id = data.id;
            let index = this.subscriptionData.findIndex((item) => item.id === id);
            if (index !== -1) {
                this.subscriptionData[index].status = data.result ? 'done' : 'error';
                logger.debug(`method:${this.subscriptionData[index].method} param:${this.subscriptionData[index].param} status:${this.subscriptionData[index].status}`);
            }
        } catch (err) {
            logger.error('handleUnsubscribe error:', err);
        }
    }

    handleSignatureNotification(data: any) {
        logger.debug(`signatureNotification: ${JSON.stringify(data, null, 2)}`);
        try {
            let slot = data.params.result.context.slot;
            let index = this.subscriptionData.findIndex((item) => item.subscriptionId === data.params.subscription);
            if (index !== -1) {
                this.subscriptionData[index].result = {
                    slot: slot,
                    err: data.params.result.value.err
                }
            }
            this.subscriptionData[index].status = 'done';
        } catch (err) {
            logger.error('handleSignatureNotification error:', err);
        }
    }

    async subscribeSignature(signature: string, commitment?: string, enableReceivedNotification?: boolean) {
        let index = this.subscriptionData.findIndex((item) => item.param === signature);
        let id;
        // 如果没有订阅过，就添加到subscriptionData，并返回id，否则返回已有的id
        if (index === -1) {
            id = this.id++; // 先返回id，再自增
            this.subscriptionData.push({
                id: id,
                startTime: new Date().getTime(),
                maxSubscriptionTime: 1000 * 60,
                method: 'signatureSubscribe',
                param: signature,
                status: 'processing'
            });
        } else {
            id = this.subscriptionData[index].id;
        }
        let params = {
            "jsonrpc": "2.0",
            "id": id,
            "method": "signatureSubscribe",
            "params": [
                signature,
              {
                "commitment": commitment || "confirmed",
                "enableReceivedNotification": enableReceivedNotification || false,
              }
            ]
        }
        try {
            while (this.ws.readyState !== WebSocket.OPEN) {
                await this.wait(1)
            }
            this.ws.send(JSON.stringify(params));
            logger.debug('subscribe signature: ', signature);
        } catch (err) {
            logger.error('subscribeSignature error:', err);
        }
    }

    async unsubscribe(method: UnscribeMethods, id: number) {
        try {
            let index = this.subscriptionData.findIndex((item) => item.id === id);
            if (index !== -1) {
                let params = {
                    "jsonrpc": "2.0",
                    "id": id,
                    "method": method,
                    "params": [this.subscriptionData[index].subscriptionId]
                }
                while (this.ws.readyState !== WebSocket.OPEN) {
                    await this.wait(1)
                }
                this.ws.send(JSON.stringify(params));
            }
        } catch (err) {
            logger.error('unsubscribe error:', err);
        }
    }

    processInvalidSubscriptionData() {
        let now = new Date().getTime();
        // 将超时的订阅状态改为timeout
        this.subscriptionData.map((item) => {
            if (now - item.startTime > item.maxSubscriptionTime && item.status === 'processing') {
                item.status = 'timeout';
            }
        });
    }

    reSubscribe() {
        this.subscriptionData.map((item) => {
            if (item.status === 'processing') {
                if (item.method === 'signatureSubscribe') {
                    this.subscribeSignature(item.param);
                }
            }
        });
    }
}