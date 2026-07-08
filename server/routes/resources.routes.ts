import { Router } from "express";
import { z } from "zod";
import db from "../db.js";
import { requireAuth, requireTutor } from "../middleware.js";

const router = Router();

/* ------------------------------------------------------------------ */
/*  GET /api/courses/:courseId/resources                                */
/* ------------------------------------------------------------------ */

router.get("/courses/:courseId/resources", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM resources WHERE course_id = ? ORDER BY id DESC")
    .all(req.params.courseId);
  res.json(rows);
});

/* ------------------------------------------------------------------ */
/*  POST /api/courses/:courseId/resources  (tutor only)                 */
/* ------------------------------------------------------------------ */

const createSchema = z.object({
  name: z.string().min(1).max(300),
  size: z.string().max(50).default("1.0 MB"),
});

router.post("/courses/:courseId/resources", requireAuth, requireTutor, (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const course = db.prepare("SELECT id FROM courses WHERE id = ?").get(req.params.courseId);
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const { name, size } = parsed.data;
  const result = db
    .prepare(
      "INSERT INTO resources (course_id, name, size, created_by) VALUES (?, ?, ?, ?)"
    )
    .run(req.params.courseId, name, size, req.user!.userId);

  res.status(201).json({
    id: result.lastInsertRowid,
    course_id: req.params.courseId,
    name,
    size,
  });
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/resources/:id  (tutor only)                            */
/* ------------------------------------------------------------------ */

router.delete("/resources/:id", requireAuth, requireTutor, (req, res) => {
  const result = db
    .prepare("DELETE FROM resources WHERE id = ?")
    .run(Number(req.params.id));
  if (result.changes === 0) {
    res.status(404).json({ error: "Resource not found" });
    return;
  }
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  Reminders (personal, per-user)                                     */
/* ------------------------------------------------------------------ */

router.get("/reminders", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM reminders WHERE user_id = ? ORDER BY day")
    .all(req.user!.userId);
  res.json(rows);
});

const reminderSchema = z.object({
  day: z.number().int().min(1).max(31),
  label: z.string().min(1).max(300),
});

router.post("/reminders", requireAuth, (req, res) => {
  const parsed = reminderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { day, label } = parsed.data;
  const result = db
    .prepare("INSERT INTO reminders (user_id, day, label) VALUES (?, ?, ?)")
    .run(req.user!.userId, day, label);

  res.status(201).json({ id: result.lastInsertRowid, user_id: req.user!.userId, day, label });
});

export default router;
