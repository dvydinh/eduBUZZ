import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import type { CookieOptions } from "express";

/* ------------------------------------------------------------------ */
/*  JWT secret — never exposed to frontend                             */
/* ------------------------------------------------------------------ */

const JWT_SECRET =
  process.env.JWT_SECRET || crypto.randomBytes(64).toString("hex");

const JWT_EXPIRES_IN = "7d";

/* ------------------------------------------------------------------ */
/*  Password hashing                                                   */
/* ------------------------------------------------------------------ */

const SALT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/* ------------------------------------------------------------------ */
/*  JWT sign / verify                                                  */
/* ------------------------------------------------------------------ */

export interface TokenPayload {
  userId: number;
  role: "student" | "tutor";
  name: string;
  isGuest: boolean;
}

export function signToken(payload: Omit<TokenPayload, "iat">): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}

/* ------------------------------------------------------------------ */
/*  Cookie config — httpOnly, secure in prod, SameSite lax             */
/* ------------------------------------------------------------------ */

export const COOKIE_NAME = "edubuzz_token";

export const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};
