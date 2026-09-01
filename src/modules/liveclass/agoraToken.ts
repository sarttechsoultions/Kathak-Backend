import { RtcRole, RtcTokenBuilder } from "agora-access-token";
import { env } from "../../config/env";

export const agoraKeyReady = () =>
  Boolean(env.agoraAppId?.trim()) &&
  Boolean(env.agoraAppCertificate?.trim()) &&
  env.agoraAppCertificate!.trim().length >= 10;

/**
 * Produces a stable numeric uid from a user's string id (Agora RTC uids must be numeric).
 * Range kept away from 1, which we reserve for the teacher, so main-video detection
 * on the frontend is a simple `uid === 1` check.
 */
export const numericUidFromString = (input: string): number => {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return (hash % 800000) + 100000; // stable range: 100000–899999
};

export const buildAgoraToken = (roomName: string, uid: number, role: "publisher" | "subscriber"): string | null => {
  if (!env.agoraAppCertificate || env.agoraAppCertificate.trim().length < 10) {
    return null;
  }

  try {
    const agoraRole = role === "publisher" ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
    const now = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = now + 86400; // 24 hours expiry for maximum clock-drift tolerance

    return RtcTokenBuilder.buildTokenWithUid(
      env.agoraAppId!.trim(),
      env.agoraAppCertificate!.trim(),
      roomName.trim(),
      uid,
      agoraRole,
      privilegeExpiredTs
    );
  } catch (error) {
    console.error("Agora Token Generation Warning:", error);
    return null;
  }
};