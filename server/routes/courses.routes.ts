import { Router } from "express";
import { z } from "zod";
import db from "../db.js";
import { requireAuth, requireTutor } from "../middleware.js";

const router = Router();

/* ------------------------------------------------------------------ */
/*  GET /api/courses                                                   */
/* ------------------------------------------------------------------ */

router.get("/", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  const role = req.user!.role;

  const { data: courses, error } = await db
    .from("courses")
    .select(`
      *,
      enrollments (user_id)
    `)
    .order('id', { ascending: true });

  if (error || !courses) {
    res.status(500).json({ error: "Failed to fetch courses" });
    return;
  }

  const result = courses.map((c: any) => {
    let is_enrolled = false;
    if (role === 'tutor' && c.created_by === userId) is_enrolled = true;
    if (role === 'student' && c.enrollments?.some((e: any) => e.user_id === userId)) is_enrolled = true;
    
    const { enrollments, ...rest } = c;
    return { ...rest, is_enrolled };
  });
  
  res.json(result);
});

/* ------------------------------------------------------------------ */
/*  POST /api/courses  (tutor only)                                    */
/* ------------------------------------------------------------------ */

const createSchema = z.object({
  name: z.string().min(1).max(200),
  goal: z.string().max(500).default(""),
  color: z.string().max(20).default("#ff9db0"),
});

router.post("/", requireAuth, requireTutor, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { name, goal, color } = parsed.data;
  const id = "c" + Date.now();

  const { error } = await db
    .from("courses")
    .insert({ id, name, goal, progress: 0, students: 0, color, created_by: req.user!.userId });

  if (error) {
    res.status(500).json({ error: "Failed to create course" });
    return;
  }

  res.status(201).json({ id, name, goal, progress: 0, students: 0, color });
});

/* ------------------------------------------------------------------ */
/*  POST /api/courses/:id/join  (student only)                         */
/* ------------------------------------------------------------------ */

router.post("/:id/join", requireAuth, async (req, res) => {
  if (req.user!.role !== "student") {
    res.status(403).json({ error: "Only students can join courses" });
    return;
  }

  const courseId = req.params.id;
  const userId = req.user!.userId;

  // Check if course exists
  const { data: course } = await db.from("courses").select("id, students").eq("id", courseId).maybeSingle();
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const { error } = await db.from("enrollments").insert({ user_id: userId, course_id: courseId });
  if (error) {
    if (error.code === '23505') { // unique violation
      res.status(400).json({ error: "Already enrolled" });
    } else {
      res.status(500).json({ error: "Failed to join course" });
    }
    return;
  }
  
  // Increment students count
  await db.from("courses").update({ students: course.students + 1 }).eq("id", courseId);

  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/courses/:id  (tutor only)                              */
/* ------------------------------------------------------------------ */

router.delete("/:id", requireAuth, requireTutor, async (req, res) => {
  const { error, count } = await db.from("courses").delete({ count: 'exact' }).eq("id", req.params.id);
  if (error || count === 0) {
    res.status(404).json({ error: "Course not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
