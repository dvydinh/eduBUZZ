import { Router } from "express";
import { z } from "zod";
import db from "../db.js";
import { requireAuth, requireTutor } from "../middleware.js";

const router = Router();

/* ------------------------------------------------------------------ */
/*  GET /api/courses/:courseId/homework                                 */
/* ------------------------------------------------------------------ */

router.get("/courses/:courseId/homework", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM homework WHERE course_id = ? ORDER BY due_day")
    .all(req.params.courseId);

  // For students, also check if they already submitted
  if (req.user!.role === "student") {
    const userId = req.user!.userId;
    const enriched = (rows as any[]).map((hw) => {
      const sub = db
        .prepare("SELECT id FROM hw_submissions WHERE homework_id = ? AND user_id = ?")
        .get(hw.id, userId);
      return { ...hw, mySubmitted: !!sub };
    });
    res.json(enriched);
    return;
  }

  res.json(rows);
});

/* ------------------------------------------------------------------ */
/*  POST /api/courses/:courseId/homework  (tutor only)                  */
/* ------------------------------------------------------------------ */

const createSchema = z.object({
  title: z.string().min(1).max(300),
  dueDay: z.number().int().min(1).max(31),
  points: z.number().int().min(0).default(0),
  desc: z.string().max(2000).default(""),
  kind: z.enum(["line", "pdf"]).default("line"),
  pdfUrl: z.string().max(2000).optional(),
  imageUrl: z.string().max(2000).optional(),
  audioUrl: z.string().max(2000).optional(),
});

router.post("/courses/:courseId/homework", requireAuth, requireTutor, (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }

  // Verify course exists
  const course = db.prepare("SELECT id FROM courses WHERE id = ?").get(req.params.courseId);
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const d = parsed.data;
  const result = db
    .prepare(
      `INSERT INTO homework (course_id, title, due_day, points, description, kind, pdf_url, image_url, audio_url, status, submissions, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, ?)`
    )
    .run(
      req.params.courseId,
      d.title,
      d.dueDay,
      d.points,
      d.desc,
      d.kind,
      d.pdfUrl || null,
      d.imageUrl || null,
      d.audioUrl || null,
      req.user!.userId
    );

  res.status(201).json({
    id: result.lastInsertRowid,
    course_id: req.params.courseId,
    title: d.title,
    due_day: d.dueDay,
    points: d.points,
    description: d.desc,
    kind: d.kind,
    pdf_url: d.pdfUrl || null,
    image_url: d.imageUrl || null,
    audio_url: d.audioUrl || null,
    status: "open",
    submissions: 0,
  });
});

/* ------------------------------------------------------------------ */
/*  POST /api/homework/:id/submit  (student)                           */
/* ------------------------------------------------------------------ */

router.post("/homework/:id/submit", requireAuth, (req, res) => {
  const hwId = Number(req.params.id);
  const hw = db.prepare("SELECT * FROM homework WHERE id = ?").get(hwId) as any;
  if (!hw) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }
  if (hw.status === "closed") {
    res.status(400).json({ error: "Homework is closed" });
    return;
  }

  const userId = req.user!.userId;

  // Check if already submitted
  const existing = db
    .prepare("SELECT id FROM hw_submissions WHERE homework_id = ? AND user_id = ?")
    .get(hwId, userId);
  if (existing) {
    res.status(409).json({ error: "Already submitted" });
    return;
  }

  const fileName = req.body.fileName || null;

  db.prepare("INSERT INTO hw_submissions (homework_id, user_id, file_name) VALUES (?, ?, ?)").run(
    hwId,
    userId,
    fileName
  );
  db.prepare("UPDATE homework SET submissions = submissions + 1 WHERE id = ?").run(hwId);

  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  PATCH /api/homework/:id/toggle-close  (tutor only)                 */
/* ------------------------------------------------------------------ */

router.patch("/homework/:id/toggle-close", requireAuth, requireTutor, (req, res) => {
  const hw = db.prepare("SELECT id, status FROM homework WHERE id = ?").get(Number(req.params.id)) as any;
  if (!hw) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }

  const newStatus = hw.status === "closed" ? "open" : "closed";
  db.prepare("UPDATE homework SET status = ? WHERE id = ?").run(newStatus, hw.id);

  res.json({ status: newStatus });
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/homework/:id  (tutor only)                             */
/* ------------------------------------------------------------------ */

router.delete("/homework/:id", requireAuth, requireTutor, (req, res) => {
  const result = db.prepare("DELETE FROM homework WHERE id = ?").run(Number(req.params.id));
  if (result.changes === 0) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
