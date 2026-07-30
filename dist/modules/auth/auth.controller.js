"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logoutUser = exports.loginUser = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../../lib/prisma");
const env_1 = require("../../config/env");
const tokenBlocklist_1 = require("../../lib/tokenBlocklist");
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password || typeof email !== "string" || typeof password !== "string") {
            res.status(400).json({ status: "error", message: "Email and password are required." });
            return;
        }
        const normalizedEmail = email.trim().toLowerCase();
        const user = await prisma_1.prisma.user.findUnique({
            where: { email: normalizedEmail },
            include: { permissions: true },
        });
        if (!user || !user.isActive) {
            res.status(401).json({ status: "error", message: "Invalid credentials." });
            return;
        }
        const isMatch = await bcryptjs_1.default.compare(password, user.passwordHash);
        if (!isMatch) {
            res.status(401).json({ status: "error", message: "Invalid credentials." });
            return;
        }
        const permissionList = user.permissions.map((p) => p.permission);
        const signOptions = { expiresIn: env_1.env.jwtExpiresIn };
        const token = jsonwebtoken_1.default.sign({
            id: user.id,
            email: user.email,
            role: user.role,
            permissions: permissionList,
        }, env_1.env.jwtSecret, signOptions);
        res.status(200).json({
            status: "success",
            message: "Login successful",
            data: {
                user: {
                    id: user.id,
                    fullName: user.fullName,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    avatarUrl: user.avatarUrl,
                    permissions: permissionList,
                },
                token,
            },
        });
    }
    catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ status: "error", message: "Internal server error during login." });
    }
};
exports.loginUser = loginUser;
const logoutUser = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
        if (token) {
            const decoded = jsonwebtoken_1.default.decode(token);
            const expiresAtMs = decoded?.exp ? decoded.exp * 1000 : Date.now() + 7 * 24 * 60 * 60 * 1000;
            (0, tokenBlocklist_1.revokeToken)(token, expiresAtMs);
        }
        res.status(200).json({
            status: "success",
            message: "Logout successful.",
        });
    }
    catch (error) {
        console.error("Logout Error:", error);
        res.status(500).json({ status: "error", message: "Internal server error during logout." });
    }
};
exports.logoutUser = logoutUser;
