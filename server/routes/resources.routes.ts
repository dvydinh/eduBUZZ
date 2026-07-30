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

import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

/* ------------------------------------------------------------------ */
/*  POST /api/courses/:courseId/resources                               */
/* ------------------------------------------------------------------ */

// We allow both tutors and students to upload resources now, as students need to share PDFs on Whiteboard.
router.post("/courses/:courseId/resources", requireAuth, upload.single("file"), (req, res) => {
  const course = db.prepare("SELECT id FROM courses WHERE id = ?").get(req.params.courseId);
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const name = req.body.name || file.originalname;
  const sizeMb = (file.size / (1024 * 1024)).toFixed(1) + " MB";
  const fileUrl = `/uploads/${file.filename}`;

  const result = db
    .prepare(
      "INSERT INTO resources (course_id, name, size, file_url, created_by) VALUES (?, ?, ?, ?, ?)"
    )
    .run(req.params.courseId, name, sizeMb, fileUrl, req.user!.userId);

  res.status(201).json({
    id: result.lastInsertRowid,
    course_id: req.params.courseId,
    name,
    size: sizeMb,
    file_url: fileUrl
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
