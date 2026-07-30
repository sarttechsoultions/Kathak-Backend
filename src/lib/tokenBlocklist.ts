/**
 * In-memory JWT denylist for logout/revocation until token expiry.
 * For multi-instance production deployments, replace with Redis.
 */
const revokedTokens = new Map<string, number>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [token, expiresAt] of revokedTokens) {
    if (expiresAt <= now) {
      revokedTokens.delete(token);
    }
  }
}

export function revokeToken(token: string, expiresAtMs: number): void {
  purgeExpired();
  revokedTokens.set(token, expiresAtMs);
}

export function isTokenRevoked(token: string): boolean {
  purgeExpired();
  return revokedTokens.has(token);
}
