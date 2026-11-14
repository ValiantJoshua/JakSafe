// Server-side CCTV frame fetcher with SSRF protections.
// Only fetches URLs that come from the trusted catalog (never from user input), and still
// blocks private/loopback/link-local targets, limits redirects, size, and content-type.

import dns from 'node:dns/promises';
import net from 'node:net';

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_REDIRECTS = 3;
export const ALLOWED_STREAM_PORTS = new Set(['', '80', '443', '8080', '8443']);

export class FrameError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || a >= 224
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 192 && b === 0 && c === 2)
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113);
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd')
      || l.startsWith('fe80') || l.startsWith('ff') || l.startsWith('::ffff:');
  }
  return true;
}

export async function assertPublicHttpUrl(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { throw new FrameError('invalid camera url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FrameError('unsupported protocol');
  if (!ALLOWED_STREAM_PORTS.has(u.port)) throw new FrameError('blocked port');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new FrameError('blocked address');
  } else {
    const addrs = await dns.lookup(host, { all: true }).catch(() => []);
    if (!addrs.length) throw new FrameError('camera host not resolvable');
    if (addrs.some((a) => isPrivateIp(a.address))) throw new FrameError('blocked address');
  }
  return u;
}

export async function readCapped(res, maxBytes = MAX_BYTES) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const ab = await res.arrayBuffer();
    if (ab.byteLength > maxBytes) throw new FrameError('frame too large');
    return Buffer.from(ab);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FrameError('frame too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Fetch upstream URL safely with manual redirect validation, port allowlist,
 * optional origin pinning, and post-connect DNS rebinding verification.
 */
export async function fetchPublicUrl(urlStr, {
  method = 'GET',
  headers = {},
  signal = undefined,
  maxRedirects = MAX_REDIRECTS,
  allowedOrigin = null,
  fetchImpl = fetch,
} = {}) {
  let currentUrl = urlStr;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const parsed = await assertPublicHttpUrl(currentUrl);
    if (allowedOrigin && parsed.origin !== allowedOrigin) {
      throw new FrameError('forbidden stream origin', 403);
    }

    const res = await fetchImpl(currentUrl, {
      method,
      headers,
      redirect: 'manual',
      signal,
    });

    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    if (!net.isIP(host)) {
      const postAddrs = await dns.lookup(host, { all: true }).catch(() => []);
      if (!postAddrs.length || postAddrs.some((a) => isPrivateIp(a.address))) {
        await res.body?.cancel?.().catch(() => {});
        throw new FrameError('blocked address (dns rebinding)');
      }
    }

    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel?.().catch(() => {});
      const loc = res.headers.get('location');
      if (!loc) throw new FrameError(`redirect ${res.status} without location`);
      currentUrl = new URL(loc, currentUrl).toString();
      continue;
    }

    return { res, finalUrl: currentUrl };
  }
  throw new FrameError('too many redirects');
}

/**
 * Fetch one JPEG/PNG frame for a catalog camera.
 * @returns {Promise<{buffer: Buffer, contentType: string, fetchedAt: string}>}
 */
export async function fetchFrame(camera) {
  if (camera.feedType && camera.feedType !== 'image') {
    throw new FrameError(`feedType "${camera.feedType}" not supported yet (only "image")`, 501);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const { res } = await fetchPublicUrl(camera.url, {
      signal: controller.signal,
      maxRedirects: MAX_REDIRECTS,
      headers: { 'User-Agent': 'jaksafe-backend/dev (academic project)', Accept: 'image/*' },
    });
    if (!res.ok) throw new FrameError(`camera responded ${res.status}`);
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) throw new FrameError('camera did not return an image');
    // Some aggregators answer with an SVG "offline" placeholder instead of a real frame.
    // Only raster photos are valid input for vision analysis.
    if (contentType === 'image/svg+xml') throw new FrameError('camera offline (placeholder image)');
    const buffer = await readCapped(res, MAX_BYTES);
    if (!buffer.length) throw new FrameError('empty frame');
    return { buffer, contentType, fetchedAt: new Date().toISOString() };
  } catch (e) {
    if (e instanceof FrameError) throw e;
    throw new FrameError(e.name === 'AbortError' ? 'camera timeout' : 'camera fetch error');
  } finally {
    clearTimeout(timer);
  }
}
