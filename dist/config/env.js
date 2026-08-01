"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const isProduction = process.env.NODE_ENV === "production";
function requireEnv(name) {
    const value = process.env[name];
    if (!value?.trim()) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value.trim();
}
function getJwtSecret() {
    const secret = requireEnv("JWT_SECRET");
    if (secret.length < 32) {
        throw new Error("JWT_SECRET must be at least 32 characters long.");
    }
    if (isProduction && (secret.includes("change_me") || secret.includes("kathak_secret"))) {
        throw new Error("JWT_SECRET must be a strong, unique value in production.");
    }
    return secret;
}
exports.env = {
    nodeEnv: process.env.NODE_ENV || "development",
    isProduction,
    port: Number(process.env.PORT) || 5000,
    databaseUrl: requireEnv("DATABASE_URL"),
    jwtSecret: getJwtSecret(),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
    frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
    jitsiAppId: process.env.JITSI_APP_ID?.trim(),
    jitsiDomain: process.env.JITSI_DOMAIN?.trim() || "8x8.vc",
    jitsiKeyId: process.env.JITSI_KEY_ID?.trim(),
    jitsiPrivateKey: process.env.JITSI_PRIVATE_KEY?.replace(/\\n/g, "\n"),
};
