import { Router } from "express";
import { z } from "zod";
import db from "../db.js";
import { requireAuth, requireTutor } from "../middleware.js";

const router = Router();

/* ------------------------------------------------------------------ */
/*  GET /api/courses/:courseId/homework                                 */
/* ------------------------------------------------------------------ */

router.get("/courses/:courseId/homework", requireAuth, async (req, res) => {
  const { data: rows, error } = await db
    .from("homework")
    .select("*")
    .eq("course_id", req.params.courseId)
    .order("due_day", { ascending: true });

  if (error || !rows) {
    res.status(500).json({ error: "Failed to fetch homework" });
    return;
  }

  // For students, also check if they already submitted
  if (req.user!.role === "student") {
    const userId = req.user!.userId;
    const { data: submissions } = await db
      .from("hw_submissions")
      .select("homework_id")
      .eq("user_id", userId)
      .in("homework_id", rows.map((r: any) => r.id));
      
    const submittedHwIds = new Set(submissions?.map((s: any) => s.homework_id) || []);

    const enriched = rows.map((hw: any) => {
      return { ...hw, mySubmitted: submittedHwIds.has(hw.id) };
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

router.post("/courses/:courseId/homework", requireAuth, requireTutor, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }

  // Verify course exists
  const { data: course } = await db.from("courses").select("id").eq("id", req.params.courseId).maybeSingle();
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const d = parsed.data;
  const { data: result, error } = await db
    .from("homework")
    .insert({
      course_id: req.params.courseId,
      title: d.title,
      due_day: d.dueDay,
      points: d.points,
      description: d.desc,
      kind: d.kind,
      pdf_url: d.pdfUrl || null,
      image_url: d.imageUrl || null,
      audio_url: d.audioUrl || null,
      status: 'open',
      submissions: 0,
      created_by: req.user!.userId
    })
    .select()
    .single();

  if (error || !result) {
    res.status(500).json({ error: "Failed to create homework" });
    return;
  }

  res.status(201).json(result);
});

/* ------------------------------------------------------------------ */
/*  POST /api/homework/:id/submit  (student)                           */
/* ------------------------------------------------------------------ */

router.post("/homework/:id/submit", requireAuth, async (req, res) => {
  const hwId = Number(req.params.id);
  const { data: hw } = await db.from("homework").select("*").eq("id", hwId).maybeSingle();
  
  if (!hw) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }
  if (hw.status === "closed") {
    res.status(400).json({ error: "Homework is closed" });
    return;
  }

  const userId = req.user!.userId;

  const fileName = req.body.fileName || null;

  const { error } = await db.from("hw_submissions").insert({
    homework_id: hwId,
    user_id: userId,
    file_name: fileName
  });
  
  if (error) {
    if (error.code === '23505') { // unique violation
       res.status(409).json({ error: "Already submitted" });
    } else {
       res.status(500).json({ error: "Failed to submit" });
    }
    return;
  }
  
  await db.from("homework").update({ submissions: hw.submissions + 1 }).eq("id", hwId);

  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  PATCH /api/homework/:id/toggle-close  (tutor only)                 */
/* ------------------------------------------------------------------ */

router.patch("/homework/:id/toggle-close", requireAuth, requireTutor, async (req, res) => {
  const { data: hw } = await db.from("homework").select("id, status").eq("id", Number(req.params.id)).maybeSingle();
  if (!hw) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }

  const newStatus = hw.status === "closed" ? "open" : "closed";
  await db.from("homework").update({ status: newStatus }).eq("id", hw.id);

  res.json({ status: newStatus });
});

/* ------------------------------------------------------------------ */
/*  PATCH /api/homework/:id  (tutor only)                              */
/* ------------------------------------------------------------------ */

const updateHomeworkSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000),
  dueDay: z.number().int().min(1).max(31),
});

router.patch("/homework/:id", requireAuth, requireTutor, async (req, res) => {
  const parsed = updateHomeworkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }

  const { data, error } = await db
    .from("homework")
    .update({ 
      title: parsed.data.title,
      description: parsed.data.description,
      due_day: parsed.data.dueDay
    })
    .eq("id", Number(req.params.id))
    .select()
    .single();

  if (error || !data) {
    res.status(500).json({ error: "Failed to update homework" });
    return;
  }
  res.json(data);
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/homework/:id  (tutor only)                             */
/* ------------------------------------------------------------------ */

router.delete("/homework/:id", requireAuth, requireTutor, async (req, res) => {
  const { error, count } = await db.from("homework").delete({ count: 'exact' }).eq("id", Number(req.params.id));
  if (error || count === 0) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
