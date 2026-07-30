import { Router } from "express";
import { z } from "zod";
import db from "../db.js";
import { requireAuth, requireTutor } from "../middleware.js";

const router = Router();

/* ------------------------------------------------------------------ */
/*  GET /api/courses                                                   */
/* ------------------------------------------------------------------ */

router.get("/", requireAuth, (req, res) => {
  const userId = req.user!.userId;
  const role = req.user!.role;

  // We fetch all courses and mark `is_enrolled: true` if the user is enrolled (student) or is the creator (tutor)
  const rows = db.prepare(`
    SELECT c.*, 
      CASE 
        WHEN ? = 'tutor' AND c.created_by = ? THEN 1
        WHEN ? = 'student' AND e.user_id IS NOT NULL THEN 1
        ELSE 0
      END as is_enrolled
    FROM courses c
    LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = ?
    ORDER BY c.rowid
  `).all(role, userId, role, userId);

  // Convert `is_enrolled` from 0/1 to boolean
  const courses = rows.map((r: any) => ({
    ...r,
    is_enrolled: Boolean(r.is_enrolled)
  }));
  
  res.json(courses);
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
/*  POST /api/courses/:id/join  (student only)                         */
/* ------------------------------------------------------------------ */

router.post("/:id/join", requireAuth, (req, res) => {
  if (req.user!.role !== "student") {
    res.status(403).json({ error: "Only students can join courses" });
    return;
  }

  const courseId = req.params.id;
  const userId = req.user!.userId;

  // Check if course exists
  const course = db.prepare("SELECT * FROM courses WHERE id = ?").get(courseId);
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  try {
    db.prepare("INSERT INTO enrollments (user_id, course_id) VALUES (?, ?)").run(userId, courseId);
    db.prepare("UPDATE courses SET students = students + 1 WHERE id = ?").run(courseId);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.message.includes("UNIQUE constraint failed")) {
      res.status(400).json({ error: "Already enrolled" });
    } else {
      res.status(500).json({ error: "Failed to join course" });
    }
  }
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
