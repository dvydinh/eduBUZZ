import { Router } from "express";
import { z } from "zod";
import db from "../db.js";
import { requireAuth, requireTutor } from "../middleware.js";

const router = Router();

/* ------------------------------------------------------------------ */
/*  GET /api/courses                                                   */
/* ------------------------------------------------------------------ */

router.get("/", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT * FROM courses ORDER BY rowid").all();
  res.json(rows);
});

/* ------------------------------------------------------------------ */
/*  POST /api/courses  (tutor only)                                    */
/* ------------------------------------------------------------------ */

const createSchema = z.object({
  name: z.string().min(1).max(200),
  goal: z.string().max(500).default(""),
  color: z.string().max(20).default("#ff9db0"),
});

router.post("/", requireAuth, requireTutor, (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { name, goal, color } = parsed.data;
  const id = "c" + Date.now();

  db.prepare(
    "INSERT INTO courses (id, name, goal, progress, students, color, created_by) VALUES (?, ?, ?, 0, 0, ?, ?)"
  ).run(id, name, goal, color, req.user!.userId);

  res.status(201).json({ id, name, goal, progress: 0, students: 0, color });
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/courses/:id  (tutor only)                              */
/* ------------------------------------------------------------------ */

router.delete("/:id", requireAuth, requireTutor, (req, res) => {
  const result = db.prepare("DELETE FROM courses WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "Course not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
