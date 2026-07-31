import { Router } from "express";
import { z } from "zod";
import db from "../db.js";
import { requireAuth, requireTutor } from "../middleware.js";
import multer from "multer";
import path from "node:path";

const router = Router();

/* ------------------------------------------------------------------ */
/*  GET /api/courses/:courseId/resources                                */
/* ------------------------------------------------------------------ */

router.get("/courses/:courseId/resources", requireAuth, async (req, res) => {
  const { data: rows, error } = await db
    .from("resources")
    .select("*")
    .eq("course_id", req.params.courseId)
    .order("id", { ascending: false });
    
  if (error || !rows) {
    res.status(500).json({ error: "Failed to fetch resources" });
    return;
  }
  res.json(rows);
});

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

/* ------------------------------------------------------------------ */
/*  POST /api/courses/:courseId/resources                               */
/* ------------------------------------------------------------------ */

// We allow both tutors and students to upload resources now, as students need to share PDFs on Whiteboard.
router.post("/courses/:courseId/resources", requireAuth, upload.single("file"), async (req, res) => {
  const { data: course } = await db.from("courses").select("id").eq("id", req.params.courseId).maybeSingle();
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

  const ext = path.extname(file.originalname);
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

  // Upload to Supabase Storage
  const { error: storageError } = await db.storage
    .from("edubuzz-resources")
    .upload(filename, file.buffer, {
      contentType: file.mimetype,
    });

  if (storageError) {
    console.error("Storage upload error:", storageError);
    res.status(500).json({ error: "Failed to upload file to storage" });
    return;
  }

  const { data: publicUrlData } = db.storage
    .from("edubuzz-resources")
    .getPublicUrl(filename);
    
  const fileUrl = publicUrlData.publicUrl;

  const { data: result, error: dbError } = await db
    .from("resources")
    .insert({
      course_id: req.params.courseId,
      name,
      size: sizeMb,
      file_url: fileUrl,
      created_by: req.user!.userId
    })
    .select()
    .single();

  if (dbError || !result) {
    res.status(500).json({ error: "Failed to save resource to database" });
    return;
  }

  res.status(201).json(result);
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/resources/:id  (tutor only)                            */
/* ------------------------------------------------------------------ */

router.delete("/resources/:id", requireAuth, requireTutor, async (req, res) => {
  const { error, count } = await db
    .from("resources")
    .delete({ count: 'exact' })
    .eq("id", Number(req.params.id));
    
  if (error || count === 0) {
    res.status(404).json({ error: "Resource not found" });
    return;
  }
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  Reminders (personal, per-user)                                     */
/* ------------------------------------------------------------------ */

router.get("/reminders", requireAuth, async (req, res) => {
  const { data: rows, error } = await db
    .from("reminders")
    .select("*")
    .eq("user_id", req.user!.userId)
    .order("day", { ascending: true });
    
  if (error || !rows) {
    res.status(500).json({ error: "Failed to fetch reminders" });
    return;
  }
  res.json(rows);
});

const reminderSchema = z.object({
  day: z.number().int().min(1).max(31),
  label: z.string().min(1).max(300),
});

router.post("/reminders", requireAuth, async (req, res) => {
  const parsed = reminderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { day, label } = parsed.data;
  
  const { data: result, error } = await db
    .from("reminders")
    .insert({
      user_id: req.user!.userId,
      day,
      label
    })
    .select()
    .single();

  if (error || !result) {
    res.status(500).json({ error: "Failed to create reminder" });
    return;
  }

  res.status(201).json(result);
});

export default router;
