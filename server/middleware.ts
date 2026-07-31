import type { Request, Response, NextFunction } from "express";
import db from "./db.js";

/* ------------------------------------------------------------------ */
/*  Extend Express Request to carry user info                          */
/* ------------------------------------------------------------------ */

export interface TokenPayload {
  userId: string;
  role: string;
  name: string;
  isGuest: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  requireAuth — reject 401 if no valid Supabase JWT token            */
/* ------------------------------------------------------------------ */

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  
  const token = authHeader.split(" ")[1];
  
  try {
    const { data: { user }, error } = await db.auth.getUser(token);
    
    if (error || !user) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    
    req.user = {
      userId: user.id,
      role: user.user_metadata?.role || 'student',
      name: user.user_metadata?.name || 'User',
      isGuest: user.is_anonymous || false
    };
    
    next();
  } catch (err) {
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
