import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import path from 'path';
import fs from 'fs';

// Local development may load this ignored file. Deployed environments should
// provide FIREBASE_SERVICE_ACCOUNT_JSON instead; never commit a service key.
const serviceAccountPath = path.resolve(__dirname, '../config/firebase-service-account.json');

const loadServiceAccount = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  if (fs.existsSync(serviceAccountPath)) {
    return require(serviceAccountPath);
  }
  return null;
};

try {
  if (!getApps().length) {
    const serviceAccount = loadServiceAccount();
    if (serviceAccount) {
      initializeApp({
        credential: cert(serviceAccount),
      });
      console.log('[Firebase] Admin SDK initialized successfully');
    } else {
      console.warn('[Firebase] Firebase credentials are not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or add the local ignored key file.');
    }
  }
} catch (error) {
  console.error('[Firebase] Failed to initialize Admin SDK:', error);
}

export const messaging = getApps().length ? getMessaging() : null;

/**
 * Sends a push notification to the given FCM tokens.
 * Automatically identifies invalid or expired tokens and returns them for cleanup.
 * 
 * @param tokens Array of FCM device tokens
 * @param title Notification title
 * @param body Notification body
 * @param data Optional payload data
 * @returns Array of invalid tokens that should be removed from the database
 */
export const sendPushNotification = async (
  tokens: string[],
  title: string,
  body: string,
  data?: { [key: string]: string }
): Promise<string[]> => {
  if (!messaging) {
    console.warn('[Firebase] Messaging not initialized, skipping push notification.');
    return [];
  }
  
  if (!tokens || tokens.length === 0) return [];

  const invalidTokens: string[] = [];

  try {
    const message = {
      notification: { title, body },
      data,
      tokens,
    };

    const response = await messaging.sendEachForMulticast(message);
    
    // Identify failed tokens
    if (response.failureCount > 0) {
      response.responses.forEach((resp: any, idx: number) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          if (
            errorCode === 'messaging/invalid-registration-token' ||
            errorCode === 'messaging/registration-token-not-registered'
          ) {
            invalidTokens.push(tokens[idx]);
          }
        }
      });
    }
  } catch (error) {
    console.error('[Firebase] Error sending multicast push notification:', error);
  }

  return invalidTokens;
};
