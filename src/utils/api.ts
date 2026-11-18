/**
 * Resolves REST API and WebSocket endpoints.
 * Uses VITE_API_URL when the frontend is hosted separately (e.g. Cloudflare Pages),
 * or falls back to same-origin relative URLs when served directly by server.ts.
 */

function getNormalizedBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL;
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\/+$/, "");
}

export function getApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = getNormalizedBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export function getLiveWsUrl(): string {
  const base = getNormalizedBaseUrl();
  if (base) {
    try {
      const parsed = new URL(base);
      const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
      return `${wsProtocol}//${parsed.host}/api/live`;
    } catch {
      // fallback below
    }
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/live`;
}
