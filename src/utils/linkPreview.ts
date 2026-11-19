import { sanitizeUrl, isSafeUrl } from "./urlSecurity";

export interface LinkMetadata {
  url: string;
  domain: string;
  title: string;
  description?: string;
  imageUrl?: string;
  faviconUrl?: string;
  isMedia?: boolean;
}

const URL_REGEX = /(https?:\/\/[^\s<>"'{}|\\^`]+)/i;
const ALL_URLS_REGEX = /(https?:\/\/[^\s<>"'{}|\\^`]+)/gi;

/**
 * Safely extracts the first valid HTTP/HTTPS URL from a message string.
 */
export function extractFirstUrl(text?: string | null): string | null {
  if (!text) return null;
  const match = text.match(URL_REGEX);
  if (!match || !match[1]) return null;
  const rawUrl = match[1].replace(/[.,;:!?)]+$/, ""); // Trim trailing punctuation
  return isSafeUrl(rawUrl) ? sanitizeUrl(rawUrl) : null;
}

/**
 * Extracts all valid HTTP/HTTPS URLs from a text string.
 */
export function extractAllUrls(text?: string | null): string[] {
  if (!text) return [];
  const matches = text.match(ALL_URLS_REGEX);
  if (!matches) return [];
  const uniqueUrls = new Set<string>();
  for (const m of matches) {
    const raw = m.replace(/[.,;:!?)]+$/, "");
    if (isSafeUrl(raw)) {
      uniqueUrls.add(sanitizeUrl(raw));
    }
  }
  return Array.from(uniqueUrls);
}

/**
 * Extracts high-fidelity metadata for URLs (YouTube, GitHub, Figma, etc.)
 * with instant client-side resolution and zero security vulnerabilities.
 */
export function getLinkMetadata(rawUrl: string): LinkMetadata {
  const cleanUrl = sanitizeUrl(rawUrl);
  let parsed: URL;
  try {
    parsed = new URL(cleanUrl);
  } catch {
    return {
      url: cleanUrl,
      domain: cleanUrl.replace(/^https?:\/\//, "").split("/")[0] || "link",
      title: "Shared Link",
    };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;

  // 1. YouTube Video Preview
  if (hostname === "youtube.com" || hostname === "m.youtube.com" || hostname === "youtu.be") {
    let videoId: string | null = null;
    if (hostname === "youtu.be") {
      videoId = parsed.pathname.slice(1).split("/")[0] || null;
    } else {
      videoId = parsed.searchParams.get("v");
    }

    if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return {
        url: cleanUrl,
        domain: "youtube.com",
        title: "YouTube Video",
        description: `Watch on YouTube (${cleanUrl})`,
        imageUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        faviconUrl,
        isMedia: true,
      };
    }
  }

  // 2. GitHub Repository Preview
  if (hostname === "github.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const owner = parts[0];
      const repo = parts[1];
      return {
        url: cleanUrl,
        domain: "github.com",
        title: `${owner}/${repo}`,
        description: `GitHub repository by ${owner}`,
        imageUrl: `https://opengraph.githubassets.com/1/${owner}/${repo}`,
        faviconUrl: "https://github.githubassets.com/favicons/favicon.png",
      };
    } else if (parts.length === 1) {
      const username = parts[0];
      return {
        url: cleanUrl,
        domain: "github.com",
        title: `${username} on GitHub`,
        description: `GitHub Profile`,
        imageUrl: `https://github.com/${username}.png`,
        faviconUrl,
      };
    }
  }

  // 3. Figma Design Link
  if (hostname === "figma.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const fileName = parts[2] ? decodeURIComponent(parts[2].replace(/-/g, " ")) : "Figma Design Project";
    return {
      url: cleanUrl,
      domain: "figma.com",
      title: fileName,
      description: "Collaborative design file on Figma",
      faviconUrl: "https://static.figma.com/app/icon/1/favicon.png",
    };
  }

  // 4. Twitter / X Link
  if (hostname === "twitter.com" || hostname === "x.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const handle = parts[0] || "User";
    return {
      url: cleanUrl,
      domain: hostname,
      title: `@${handle} on X`,
      description: `View post or profile on ${hostname}`,
      faviconUrl,
    };
  }

  // 5. Standard Website fallback with clean formatting
  const pathParts = parsed.pathname.split("/").filter(Boolean);
  let cleanTitle = hostname;
  if (pathParts.length > 0) {
    const lastPart = pathParts[pathParts.length - 1];
    cleanTitle = decodeURIComponent(lastPart.replace(/[-_]/g, " ").replace(/\.[a-z0-9]+$/i, ""));
    cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);
    if (cleanTitle.length < 3 || cleanTitle.length > 60) {
      cleanTitle = hostname;
    }
  }

  return {
    url: cleanUrl,
    domain: hostname,
    title: cleanTitle,
    description: parsed.pathname !== "/" ? parsed.pathname : cleanUrl,
    faviconUrl,
  };
}
