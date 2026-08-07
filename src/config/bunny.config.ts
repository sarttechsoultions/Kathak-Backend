import { env } from "./env";

export const BUNNY_CONFIG = {
  libraryId: env.bunnyLibraryId,
  apiKey: env.bunnyApiKey,
  streamBaseUrl: "https://video.bunnycdn.com/library",
  iframeBaseUrl: "https://iframe.mediadelivery.net/embed",
};