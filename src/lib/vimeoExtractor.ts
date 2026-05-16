/**
 * Vimeo URL parser.
 * Extracts video ID and optional hash from various Vimeo URL formats.
 * Actual stream resolution happens server-side using the Vimeo API.
 */

/**
 * Parse Vimeo video ID and optional hash from various URL formats:
 * - https://vimeo.com/1234567890/abc123hash
 * - https://vimeo.com/1234567890?h=abc123hash
 * - https://player.vimeo.com/video/1234567890?h=abc123hash
 */
export function parseVimeoUrl(videoUrl: string): { id: string; hash: string } | null {
  const pathMatch = videoUrl.match(/vimeo\.com\/(?:video\/)?(\d+)\/([a-zA-Z0-9]+)/);
  if (pathMatch) {
    return { id: pathMatch[1], hash: pathMatch[2] };
  }

  const idMatch = videoUrl.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (idMatch) {
    try {
      const urlObj = new URL(videoUrl);
      const hash = urlObj.searchParams.get('h') || '';
      return { id: idMatch[1], hash };
    } catch {
      return { id: idMatch[1], hash: '' };
    }
  }

  return null;
}

/**
 * Check if a URL is a Vimeo video URL.
 */
export function isVimeoUrl(url: string): boolean {
  return /vimeo\.com\/(?:video\/)?\d+/.test(url);
}

/**
 * Fetch the direct video URL from Vimeo's player config.
 * This MUST run in the browser — the browser's referer allows access to the config endpoint.
 * Returns a direct CDN URL (progressive MP4 or HLS) that AssemblyAI can fetch.
 */
export async function getVimeoDirectUrl(videoUrl: string): Promise<string> {
  const parsed = parseVimeoUrl(videoUrl);
  if (!parsed) throw new Error('Invalid Vimeo URL');

  const configUrl = `https://player.vimeo.com/video/${parsed.id}/config` +
    (parsed.hash ? `?h=${parsed.hash}` : '');

  const res = await fetch(configUrl, {
    headers: { Referer: window.location.href },
  });

  if (!res.ok) {
    throw new Error(`Vimeo config fetch failed: ${res.status}`);
  }

  const config = await res.json();

  // Progressive MP4 — prefer lowest quality (smallest file, fastest for transcription)
  const progressive = config?.request?.files?.progressive;
  if (progressive && progressive.length > 0) {
    const sorted = [...progressive].sort(
      (a: any, b: any) => (a.width || 0) - (b.width || 0)
    );
    return sorted[0].url;
  }

  // HLS fallback
  const hls = config?.request?.files?.hls;
  if (hls) {
    const defaultCdn = hls.default_cdn;
    const hlsUrl = hls.cdns?.[defaultCdn]?.url
      || Object.values(hls.cdns || {})[0]?.url;
    if (hlsUrl) return hlsUrl as string;
  }

  throw new Error('Could not extract video URL from Vimeo config');
}
