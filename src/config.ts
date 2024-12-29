import "dotenv/config";

export const LOGGER_LEVEL = process.env.LOGGER_LEVEL
export const commitment = process.env.COMMITMENT || "confirmed";
export const enableReceivedNotification = process.env.ENABLE_RECEIVED_NOTIFICATION === "true" ? true : false;
export const maxSubscriptionTime = parseInt(process.env.MAX_SUBSCRIPTION_TIME || "60000");