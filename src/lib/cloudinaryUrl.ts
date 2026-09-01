import cloudinary from "../config/cloudinary.config";

export type ParsedCloudinaryUrl = {
  publicId: string;
  resourceType: string;
  format?: string;
  version?: string;
};

export function parseCloudinaryUrl(url: string): ParsedCloudinaryUrl | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("res.cloudinary.com")) return null;

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 4 || parts[2] !== "upload") return null;

    const resourceType = parts[1];
    if (!["image", "raw", "video"].includes(resourceType)) return null;

    let idx = 3;
    let version: string | undefined;

    while (idx < parts.length) {
      const part = parts[idx];
      if (/^v\d+$/.test(part)) {
        version = part.slice(1);
        idx += 1;
        break;
      }
      if (part.includes(",") || (/^[a-z]_[\w,]+$/.test(part) && !part.includes("."))) {
        idx += 1;
        continue;
      }
      break;
    }

    const publicIdWithExt = decodeURIComponent(parts.slice(idx).join("/"));
    if (!publicIdWithExt) return null;

    const extMatch = publicIdWithExt.match(/\.([^.]+)$/);
    const format = extMatch?.[1]?.toLowerCase();
    const publicId = format ? publicIdWithExt.slice(0, -(format.length + 1)) : publicIdWithExt;

    return { publicId, resourceType, format, version };
  } catch {
    return null;
  }
}

function addSignedUrl(
  urls: Set<string>,
  publicId: string,
  resourceType: "image" | "raw" | "video",
  options?: { format?: string; version?: number | string }
) {
  urls.add(
    cloudinary.url(publicId, {
      resource_type: resourceType,
      type: "upload",
      secure: true,
      sign_url: true,
      ...(options?.format ? { format: options.format } : {}),
      ...(options?.version ? { version: options.version } : {}),
    })
  );
}

export function buildSignedCloudinaryUrls(parsed: ParsedCloudinaryUrl, originalUrl: string): string[] {
  const urls = new Set<string>();
  const { publicId, resourceType, format, version } = parsed;
  const isPdf = format === "pdf" || originalUrl.toLowerCase().includes(".pdf");
  const versionOpt = version ? { version } : undefined;

  if (resourceType === "raw" || isPdf) {
    addSignedUrl(urls, publicId, "image", { format: "pdf", ...versionOpt });
    addSignedUrl(urls, publicId, "raw", isPdf ? { format: "pdf", ...versionOpt } : versionOpt);
  }

  addSignedUrl(urls, publicId, resourceType as "image" | "raw" | "video", {
    format,
    ...versionOpt,
  });

  urls.add(originalUrl);
  return Array.from(urls);
}

export async function resolveCloudinaryDownloadCandidates(sourceUrl: string): Promise<string[]> {
  const parsed = parseCloudinaryUrl(sourceUrl);
  if (!parsed) return [sourceUrl];

  const privateUrls: string[] = [];
  const apiUrls: string[] = [];
  const signedUrls = buildSignedCloudinaryUrls(parsed, sourceUrl);
  const resourceTypes: Array<"image" | "raw" | "video"> = ["image", "raw", "video"];
  const expiresAt = Math.round(Date.now() / 1000) + 3600;

  for (const resourceType of resourceTypes) {
    try {
      privateUrls.push(
        cloudinary.utils.private_download_url(parsed.publicId, parsed.format || "pdf", {
          resource_type: resourceType,
          type: "upload",
          expires_at: expiresAt,
          attachment: false,
        })
      );
    } catch {
      // Ignore invalid combinations for private download URLs.
    }
  }

  for (const resourceType of resourceTypes) {
    try {
      const info = (await cloudinary.api.resource(parsed.publicId, { resource_type: resourceType })) as {
        public_id: string;
        resource_type: string;
        type?: string;
        version?: number;
        format?: string;
        secure_url?: string;
      };

      apiUrls.push(
        cloudinary.url(info.public_id, {
          resource_type: info.resource_type as "image" | "raw" | "video",
          type: info.type || "upload",
          version: info.version,
          format: info.format || parsed.format,
          sign_url: true,
          secure: true,
        })
      );

      if (info.secure_url) {
        apiUrls.push(info.secure_url);
      }
    } catch (error: unknown) {
      const httpCode = (error as { http_code?: number })?.http_code;
      if (httpCode !== 404) {
        console.warn(
          "Cloudinary resource lookup failed:",
          resourceType,
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  return [...new Set([...privateUrls, ...apiUrls, ...signedUrls, sourceUrl])];
}
