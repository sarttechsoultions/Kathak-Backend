export const BUNNY_CONFIG = {
  get libraryId() {
    return process.env.BUNNY_LIBRARY_ID || "717692";
  },
  get apiKey() {
    return process.env.BUNNY_STREAM_API_KEY || "4f8c9d09-63a5-46db-a9a1936d8012-86dd-4be0";
  },
  streamBaseUrl: "https://video.bunnycdn.com/library",
  iframeBaseUrl: "https://iframe.mediadelivery.net/embed"
};
