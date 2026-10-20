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
  const router = Router();

  router.post('/login', async (req, res) => {
    const body = parse(loginSchema, req.body);
    const user = await db.one('SELECT * FROM users WHERE lower(email) = lower($1)', [body.email]);
    if (!user || !verifyPassword(body.password, user.salt, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    res.setHeader('Set-Cookie', sessionCookie(issueSession(user.id), 60 * 60 * 12));
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  });

  router.post('/register', async (req, res) => {
    const body = parse(registerSchema, req.body);
    const exists = await db.one('SELECT id FROM users WHERE lower(email) = lower($1)', [body.email]);
    if (exists) throw conflict('An account with that email already exists');

    const { salt, hash } = hashPassword(body.password);
    const user = await db.one(
      'INSERT INTO users (email, name, password_hash, salt) VALUES ($1,$2,$3,$4) RETURNING id, email, name, role',
      [body.email, body.name, hash, salt],
    );
    res.setHeader('Set-Cookie', sessionCookie(issueSession(user.id), 60 * 60 * 12));
    res.status(201).json(user);
  });

  router.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', clearCookie());
    res.status(204).end();
  });

  router.get('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    res.json(req.user);
  });

  return router;
}
