import crypto from 'node:crypto';

const SCRYPT_BYTES = 32;
const MIN_SECRET = 4;
const MAX_SECRET = 64;

export function validateNewSecret(secret) {
  const value = String(secret || '');
  if (value.length < MIN_SECRET) return { ok: false, message: `Secret word must be at least ${MIN_SECRET} characters.` };
  if (value.length > MAX_SECRET) return { ok: false, message: `Secret word must be no more than ${MAX_SECRET} characters.` };
  return { ok: true };
}

export function hashSecret(secret, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(secret), salt, SCRYPT_BYTES, (error, key) => {
      if (error) reject(error);
      else resolve(key.toString('hex'));
    });
  });
}

export async function verifySecret(secret, salt, expectedHex) {
  try {
    const actual = Buffer.from(await hashSecret(secret, salt), 'hex');
    const expected = Buffer.from(String(expectedHex || ''), 'hex');
    return actual.length === SCRYPT_BYTES && expected.length === SCRYPT_BYTES && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export class AttemptLimiter {
  constructor({ limit = 5, windowMs = 60000, blockMs = 60000, now = Date.now } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.blockMs = blockMs;
    this.now = now;
    this.entries = new Map();
  }

  check(key) {
    const at = this.now();
    const entry = this.entries.get(key);
    if (!entry) return { ok: true };
    if (entry.blockedUntil > at) return { ok: false, retryMs: entry.blockedUntil - at };
    if (entry.blockedUntil || at - entry.firstAt >= this.windowMs) this.entries.delete(key);
    return { ok: true };
  }

  fail(key) {
    const at = this.now();
    let entry = this.entries.get(key);
    if (!entry || entry.blockedUntil || at - entry.firstAt >= this.windowMs) entry = { fails: 0, firstAt: at, blockedUntil: 0 };
    entry.fails++;
    if (entry.fails >= this.limit) entry.blockedUntil = at + this.blockMs;
    this.entries.set(key, entry);
    return this.check(key);
  }

  clear(key) {
    this.entries.delete(key);
  }
}

export function isAllowedOrigin(origin, host, configured = '') {
  if (!origin) return true;
  const allow = String(configured).split(',').map((value) => value.trim().replace(/\/$/, '')).filter(Boolean);
  const normalized = String(origin).replace(/\/$/, '');
  if (allow.length) return allow.includes(normalized);
  try {
    return new URL(origin).host === String(host || '').split(',')[0].trim();
  } catch {
    return false;
  }
}

export function securityHeaders() {
  return {
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  };
}
