import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './db.js';

const DATA_DIR = process.env.LEDGERLY_DATA_DIR ?? join(ROOT, 'data');
const SECRET_FILE = join(DATA_DIR, 'session.key');
export const SESSION_COOKIE = 'ledgerly_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

let cached = null;

/**
 * Session signing key. Locally it is generated once into data/session.key.
 * Serverless filesystems are read-only and ephemeral, so a deployment must set
 * SESSION_SECRET — otherwise every instance would sign with a different key.
 */
function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (cached) return cached;

  try {
    mkdirSync(DATA_DIR, { recursive: true });
    if (!existsSync(SECRET_FILE)) writeFileSync(SECRET_FILE, randomBytes(48).toString('hex'), { mode: 0o600 });
    cached = readFileSync(SECRET_FILE, 'utf8').trim();
    return cached;
  } catch (err) {
    if (process.env.VERCEL) {
      throw new Error(
        'SESSION_SECRET is not set. Add it to the Vercel project environment variables '
        + '(openssl rand -hex 48) so sessions survive across serverless instances.',
      );
    }
    throw err;
  }
}

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHex) {
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function issueSession(userId) {
  return sign({ uid: userId, exp: Date.now() + SESSION_TTL_MS });
}

export function readSession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header = '') {
  return header.split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx > 0) acc[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    return acc;
  }, {});
}

export function authRequired(db) {
  return async (req, res, next) => {
    const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
    const session = readSession(token);
    if (!session) return res.status(401).json({ error: 'Authentication required' });
    const user = await db.one('SELECT id, email, name, role FROM users WHERE id = $1', [session.uid]);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    req.user = user;
    next();
  };
}

export const sessionCookie = (token, maxAgeSeconds) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;

export const clearCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
