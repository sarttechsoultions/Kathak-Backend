"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
exports.notFoundHandler = notFoundHandler;
exports.errorHandler = errorHandler;
const env_1 = require("../config/env");
class AppError extends Error {
    statusCode;
    isOperational;
    constructor(statusCode, message, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.name = "AppError";
    }
}
exports.AppError = AppError;
function notFoundHandler(req, res) {
    res.status(404).json({
        status: "error",
        message: `Route not found: ${req.method} ${req.originalUrl}`,
    });
}
function errorHandler(err, _req, res, _next) {
    if (err instanceof AppError) {
        res.status(err.statusCode).json({
            status: "error",
            message: err.message,
        });
        return;
    }
    console.error("Unhandled error:", err);
    res.status(500).json({
        status: "error",
        message: env_1.env.isProduction ? "Internal server error." : err.message,
    });
}
