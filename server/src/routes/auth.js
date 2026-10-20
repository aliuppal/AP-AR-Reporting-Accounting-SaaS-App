import { Router } from 'express';
import { z } from 'zod';
import { clearCookie, hashPassword, issueSession, sessionCookie, verifyPassword } from '../auth.js';
import { conflict, parse } from '../http.js';

const registerSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

export function authRouter(db) {
  const r = Router();

  r.post('/login', (req, res) => {
    const body = parse(loginSchema, req.body);
    const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(body.email);
    if (!user || !verifyPassword(body.password, user.salt, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    res.setHeader('Set-Cookie', sessionCookie(issueSession(user.id), 60 * 60 * 12));
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  });

  r.post('/register', (req, res) => {
    const body = parse(registerSchema, req.body);
    const exists = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(body.email);
    if (exists) throw conflict('An account with that email already exists');
    const { salt, hash } = hashPassword(body.password);
    const result = db.prepare('INSERT INTO users (email, name, password_hash, salt) VALUES (?, ?, ?, ?)')
      .run(body.email, body.name, hash, salt);
    const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(Number(result.lastInsertRowid));
    res.setHeader('Set-Cookie', sessionCookie(issueSession(user.id), 60 * 60 * 12));
    res.status(201).json(user);
  });

  r.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', clearCookie());
    res.status(204).end();
  });

  r.get('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    res.json(req.user);
  });

  return r;
}
