/**
 * URL Security and Protocol Sanitization Utility
 * Strictly prevents XSS, javascript:, vbscript:, and malicious schemes
 * while preserving legitimate HTTPS/HTTP, Cloudinary, Firebase Storage, and mailto links.
 */

const DANGEROUS_SCHEMES = [
  "javascript:",
  "vbscript:",
  "data:text/html",
  "data:text/javascript",
  "data:application/javascript",
  "file:",
];

/**
 * Returns true if a URL is safe to be used in href or src attributes.
 */
export function isSafeUrl(url?: string | null): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();

  // Explicitly block dangerous script schemes
  for (const scheme of DANGEROUS_SCHEMES) {
    if (lower.startsWith(scheme)) return false;
  }

  // Support relative paths (e.g. /uploads/...)
  if (trimmed.startsWith("/")) return true;

  // Support safe protocols: http, https, mailto, tel
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:" || protocol === "tel:";
  } catch (_) {
    // If it's a relative URL without leading slash or a hash anchor
    if (trimmed.startsWith("#")) return true;
    // Disallow arbitrary unparseable non-relative strings
    return false;
  }
}

/**
 * Sanitizes a URL, returning a safe fallback (e.g. "#" or empty string) if unsafe.
 */
export function sanitizeUrl(url?: string | null, fallback: string = "#"): string {
  if (isSafeUrl(url)) {
    return url!.trim();
  }
  return fallback;
}

/**
 * Sanitizes an external web link (e.g. GitHub, LinkedIn, Portfolio).
 * Automatically prepends https:// if missing, while strictly blocking dangerous schemes.
 */
export function sanitizeExternalLink(link?: string | null): string {
  if (!link || typeof link !== "string") return "";
  const trimmed = link.trim();
  if (!trimmed) return "";

  const lower = trimmed.toLowerCase();
  for (const scheme of DANGEROUS_SCHEMES) {
    if (lower.startsWith(scheme)) return "";
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return isSafeUrl(trimmed) ? trimmed : "";
  }

  // Prepend https:// for domain-only entries (e.g. github.com/username)
  const formatted = `https://${trimmed}`;
  return isSafeUrl(formatted) ? formatted : "";
}
