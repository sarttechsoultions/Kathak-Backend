"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.revokeToken = revokeToken;
exports.isTokenRevoked = isTokenRevoked;
/**
 * In-memory JWT denylist for logout/revocation until token expiry.
 * For multi-instance production deployments, replace with Redis.
 */
const revokedTokens = new Map();
function purgeExpired() {
    const now = Date.now();
    for (const [token, expiresAt] of revokedTokens) {
        if (expiresAt <= now) {
            revokedTokens.delete(token);
        }
    }
}
function revokeToken(token, expiresAtMs) {
    purgeExpired();
    revokedTokens.set(token, expiresAtMs);
}
function isTokenRevoked(token) {
    purgeExpired();
    return revokedTokens.has(token);
}
