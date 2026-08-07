/**
 * JWT denylist for logout/revocation until token expiry.
 *
 * Uses Redis when REDIS_URL is configured (required for any multi-instance
 * deployment — a plain in-memory Map only protects the single process it
 * runs in, so logout on one instance would not revoke the token on others).
 * Falls back to in-memory storage for local development when REDIS_URL is
 * not set.
 */
import { env } from "../config/env";

interface Blocklist {
  revoke(token: string, expiresAtMs: number): Promise<void>;
  isRevoked(token: string): Promise<boolean>;
}

class InMemoryBlocklist implements Blocklist {
  private revokedTokens = new Map<string, number>();

  private purgeExpired(): void {
    const now = Date.now();
    for (const [token, expiresAt] of this.revokedTokens) {
      if (expiresAt <= now) {
        this.revokedTokens.delete(token);
      }
    }
  }

  async revoke(token: string, expiresAtMs: number): Promise<void> {
    this.purgeExpired();
    this.revokedTokens.set(token, expiresAtMs);
  }

  async isRevoked(token: string): Promise<boolean> {
    this.purgeExpired();
    return this.revokedTokens.has(token);
  }
}

class RedisBlocklist implements Blocklist {
  private clientPromise: Promise<import("ioredis").Redis>;

  constructor(redisUrl: string) {
    // Lazy import so `ioredis` is only required when REDIS_URL is actually set.
    this.clientPromise = import("ioredis").then(({ default: Redis }) => new Redis(redisUrl));
  }

  private key(token: string): string {
    return `revoked_token:${token}`;
  }

  async revoke(token: string, expiresAtMs: number): Promise<void> {
    const client = await this.clientPromise;
    const ttlSeconds = Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000));
    await client.set(this.key(token), "1", "EX", ttlSeconds);
  }

  async isRevoked(token: string): Promise<boolean> {
    const client = await this.clientPromise;
    const result = await client.exists(this.key(token));
    return result === 1;
  }
}

const blocklist: Blocklist = env.redisUrl
  ? new RedisBlocklist(env.redisUrl)
  : new InMemoryBlocklist();

if (!env.redisUrl && env.isProduction) {
  console.warn(
    "⚠️  REDIS_URL is not set. Token revocation is using in-memory storage, " +
    "which will NOT work correctly across multiple server instances. " +
    "Set REDIS_URL before running more than one instance in production."
  );
}

export async function revokeToken(token: string, expiresAtMs: number): Promise<void> {
  await blocklist.revoke(token, expiresAtMs);
}

export async function isTokenRevoked(token: string): Promise<boolean> {
  return blocklist.isRevoked(token);
}