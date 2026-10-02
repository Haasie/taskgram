import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

export const SESSION_COOKIE = 'taskgram_session';

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

/** Ondertekent een JSON-payload met HMAC-SHA256 (stateless, geen serveropslag). */
export function seal(data: object, secret: string): string {
  const payload = b64(JSON.stringify(data));
  return `${payload}.${sign(payload, secret)}`;
}

export function unseal<T>(token: string | undefined, secret: string): T | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as T;
  } catch {
    return null;
  }
}

type Session = { u: string; exp: number; v: 1 };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Cookies zijn altijd `Secure`, behalve bij lokale ontwikkeling (localhost) of als
 * COOKIE_INSECURE=true expliciet is gezet (bijv. testen via http op een LAN-adres).
 * Er wordt bewust niet op client-headers zoals x-forwarded-proto vertrouwd.
 */
export function isSecureRequest(c: Context): boolean {
  if (process.env.COOKIE_INSECURE === 'true') return false;
  return !LOCAL_HOSTS.has(new URL(c.req.url).hostname);
}

export function readSession(c: Context, secret: string, now = Date.now()): string | null {
  const session = unseal<Session>(getCookie(c, SESSION_COOKIE), secret);
  if (!session || session.v !== 1 || typeof session.u !== 'string' || session.exp < now) return null;
  return session.u;
}

export function writeSession(c: Context, user: string, secret: string, days: number, now = Date.now()) {
  const maxAge = days * 24 * 3600;
  setCookie(c, SESSION_COOKIE, seal({ u: user, exp: now + maxAge * 1000, v: 1 }, secret), {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: 'Lax',
    path: '/',
    maxAge
  });
}

export function clearSession(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isSecureRequest(c) });
}
