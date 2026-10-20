import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './db.js';

const SECRET_FILE = join(DATA_DIR, 'session.key');
export const SESSION_COOKIE = 'ledgerly_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

function secret() {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(SECRET_FILE)) writeFileSync(SECRET_FILE, randomBytes(48).toString('hex'), { mode: 0o600 });
  return readFileSync(SECRET_FILE, 'utf8').trim();
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
  return (req, res, next) => {
    const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
    const session = readSession(token);
    if (!session) return res.status(401).json({ error: 'Authentication required' });
    const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(session.uid);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    req.user = user;
    next();
  };
}

export const sessionCookie = (token, maxAgeSeconds) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;

export const clearCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
