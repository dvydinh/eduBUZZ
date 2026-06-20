import type { Request, Response, NextFunction } from "express";
import { verifyToken, COOKIE_NAME, type TokenPayload } from "./auth.js";

/* ------------------------------------------------------------------ */
/*  Extend Express Request to carry user info                          */
/* ------------------------------------------------------------------ */

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  requireAuth — reject 401 if no valid JWT cookie                    */
/* ------------------------------------------------------------------ */

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/* ------------------------------------------------------------------ */
/*  requireTutor — reject 403 if user is not a tutor                   */
/* ------------------------------------------------------------------ */

export function requireTutor(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "tutor") {
    res.status(403).json({ error: "Tutor access required" });
    return;
  }
  next();
}
