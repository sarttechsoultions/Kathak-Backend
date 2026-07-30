"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
require("./types/auth");
const auth_routes_1 = __importDefault(require("./modules/auth/auth.routes"));
const admin_routes_1 = __importDefault(require("./modules/admin/admin.routes"));
const env_1 = require("./config/env");
const error_middleware_1 = require("./middleware/error.middleware");
const rateLimit_middleware_1 = require("./middleware/rateLimit.middleware");
const app = (0, express_1.default)();
app.disable("x-powered-by");
app.use((0, helmet_1.default)({
    crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use((0, cors_1.default)({
    origin: env_1.env.frontendUrl,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(rateLimit_middleware_1.generalRateLimiter);
app.use(express_1.default.json({ limit: "10kb" }));
app.use(express_1.default.urlencoded({ extended: true, limit: "10kb" }));
app.get("/api/v1/health", (_req, res) => {
    res.status(200).json({
        status: "success",
        message: "Kathak Next Express Backend API is running smoothly!",
        timestamp: new Date().toISOString(),
        environment: env_1.env.nodeEnv,
    });
});
app.use("/api/v1/auth", auth_routes_1.default);
app.use("/api/v1/admin", admin_routes_1.default);
app.use(error_middleware_1.notFoundHandler);
app.use(error_middleware_1.errorHandler);
app.listen(env_1.env.port, () => {
    console.log(`==================================================`);
    console.log(`🚀 Kathak Express Server running on: http://localhost:${env_1.env.port}`);
    console.log(`🔗 Health Check URL: http://localhost:${env_1.env.port}/api/v1/health`);
    console.log(`🔒 Environment: ${env_1.env.nodeEnv}`);
    console.log(`==================================================`);
});
