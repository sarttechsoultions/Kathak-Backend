"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.requireRole = requireRole;
exports.requirePermission = requirePermission;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
const env_1 = require("../config/env");
const tokenBlocklist_1 = require("../lib/tokenBlocklist");
function extractBearerToken(req) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
        return null;
    }
    const token = header.slice(7).trim();
    return token.length > 0 ? token : null;
}
function authenticate(req, res, next) {
    const token = extractBearerToken(req);
    if (!token) {
        // In development mode, provide fallback Admin session
        if (env_1.env.nodeEnv === "development") {
            req.user = {
                id: "admin-dev-01",
                email: "admin@kathakbyharshita.com",
                role: client_1.Role.ADMIN,
                permissions: Object.values(client_1.Permission)
            };
            return next();
        }
        res.status(401).json({ status: "error", message: "Authentication required." });
        return;
    }
    if ((0, tokenBlocklist_1.isTokenRevoked)(token)) {
        res.status(401).json({ status: "error", message: "Session expired. Please log in again." });
        return;
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, env_1.env.jwtSecret);
        req.user = {
            id: decoded.id,
            email: decoded.email,
            role: decoded.role,
            permissions: decoded.permissions ?? [],
        };
        next();
    }
    catch {
        // Development Mode Fallback: Allow dev token / admin session to succeed smoothly
        if (env_1.env.nodeEnv === "development") {
            req.user = {
                id: "admin-dev-01",
                email: "admin@kathakbyharshita.com",
                role: client_1.Role.ADMIN,
                permissions: Object.values(client_1.Permission)
            };
            return next();
        }
        res.status(401).json({ status: "error", message: "Invalid or expired token." });
    }
}
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ status: "error", message: "Authentication required." });
            return;
        }
        if (!roles.includes(req.user.role)) {
            res.status(403).json({ status: "error", message: "Access denied. Insufficient role permissions." });
            return;
        }
        next();
    };
}
function requirePermission(...permissions) {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ status: "error", message: "Authentication required." });
            return;
        }
        if (req.user.role === client_1.Role.ADMIN) {
            next();
            return;
        }
        const hasPermission = permissions.every((p) => req.user?.permissions.includes(p));
        if (!hasPermission) {
            res.status(403).json({ status: "error", message: "Access denied. Required permission missing." });
            return;
        }
        next();
    };
}
