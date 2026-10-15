// Server-side CCTV frame fetcher with SSRF protections.
// Only fetches URLs that come from the trusted catalog (never from user input), and still
// blocks private/loopback/link-local targets, limits redirects, size, and content-type.

import dns from 'node:dns/promises';
import net from 'node:net';

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_REDIRECTS = 3;

export class FrameError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd')
      || l.startsWith('fe80') || l.startsWith('::ffff:');
  }
  return true;
}

async function assertPublicHttpUrl(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { throw new FrameError('invalid camera url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FrameError('unsupported protocol');
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

async function readCapped(res, maxBytes) {
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
    let url = camera.url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await assertPublicHttpUrl(url);
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'User-Agent': 'jaksafe-backend/dev (academic project)', Accept: 'image/*' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location'), url).toString();
        continue;
      }
      if (!res.ok) throw new FrameError(`camera responded ${res.status}`);
      const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!contentType.startsWith('image/')) throw new FrameError('camera did not return an image');
      const buffer = await readCapped(res, MAX_BYTES);
      if (!buffer.length) throw new FrameError('empty frame');
      return { buffer, contentType, fetchedAt: new Date().toISOString() };
    }
    throw new FrameError('too many redirects');
  } catch (e) {
    if (e instanceof FrameError) throw e;
    throw new FrameError(e.name === 'AbortError' ? 'camera timeout' : 'camera fetch error');
  } finally {
    clearTimeout(timer);
  }
}
