import { Router } from "express";
import { z } from "zod";
import db from "../db.js";
import {
  hashPassword,
  verifyPassword,
  signToken,
  COOKIE_NAME,
  cookieOptions,
} from "../auth.js";
import { requireAuth } from "../middleware.js";

const router = Router();

/* ------------------------------------------------------------------ */
/*  POST /api/auth/signup                                              */
/* ------------------------------------------------------------------ */

const signupSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(255),
  password: z.string().min(4).max(128),
  role: z.enum(["student", "tutor"]),
});

router.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const { name, email, password, role } = parsed.data;

  // Check existing
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const password_hash = await hashPassword(password);
  const result = db
    .prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)")
    .run(name, email, password_hash, role);

  const userId = result.lastInsertRowid as number;
  const token = signToken({ userId, role, name, isGuest: false });

  res.cookie(COOKIE_NAME, token, cookieOptions);
  res.status(201).json({ id: userId, name, role });
});

/* ------------------------------------------------------------------ */
/*  POST /api/auth/login                                               */
/* ------------------------------------------------------------------ */

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { email, password } = parsed.data;

  const user = db
    .prepare("SELECT id, name, email, password_hash, role FROM users WHERE email = ?")
    .get(email) as { id: number; name: string; email: string; password_hash: string; role: "student" | "tutor" } | undefined;

  if (!user || !user.password_hash) {
    // Generic message to prevent email enumeration
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const token = signToken({
    userId: user.id,
    role: user.role,
    name: user.name,
    isGuest: false,
  });

  res.cookie(COOKIE_NAME, token, cookieOptions);
  res.json({ id: user.id, name: user.name, role: user.role });
});

/* ------------------------------------------------------------------ */
/*  POST /api/auth/guest                                               */
/* ------------------------------------------------------------------ */

const guestSchema = z.object({
  name: z.string().min(1).max(100),
  passcode: z.string().min(4).max(64),
  role: z.enum(["student", "tutor"]),
});

router.post("/guest", (req, res) => {
  const parsed = guestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { name, role } = parsed.data;

  // Create a guest user (no email/password stored)
  const result = db
    .prepare("INSERT INTO users (name, role, is_guest) VALUES (?, ?, 1)")
    .run(name, role);

  const userId = result.lastInsertRowid as number;
  const token = signToken({ userId, role, name, isGuest: true });

  res.cookie(COOKIE_NAME, token, cookieOptions);
  res.status(201).json({ id: userId, name, role });
});

/* ------------------------------------------------------------------ */
/*  POST /api/auth/logout                                              */
/* ------------------------------------------------------------------ */

router.post("/logout", requireAuth, (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  GET /api/auth/me                                                   */
/* ------------------------------------------------------------------ */

router.get("/me", requireAuth, (req, res) => {
  res.json({
    id: req.user!.userId,
    name: req.user!.name,
    role: req.user!.role,
  });
});

export default router;
