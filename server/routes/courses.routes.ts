import { Router } from "express";
import { z } from "zod";
import db from "../db.js";
import { requireAuth, requireTutor } from "../middleware.js";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const createAdminClient = () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to invite users");
  }
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY);
};

const sendInviteEmail = async (email: string, courseName: string, inviterName: string, role: string) => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "465"),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const html = `
    <div style="font-family: 'Fredoka', sans-serif; text-align: center; color: #4a3b12;">
      <h1>You've been invited!</h1>
      <p><strong>${inviterName}</strong> (${role}) has invited you to join the course <strong>${courseName}</strong> on eduBUZZ.</p>
      <br />
      <a href="${process.env.FRONTEND_URL || 'https://edubuzz.onrender.com'}" style="display:inline-block; padding: 12px 24px; background: #ffcf3f; color: #4a3b12; text-decoration: none; border-radius: 20px; font-weight: bold; border: 3px solid #4a3b12;">Open eduBUZZ</a>
    </div>
  `;
  await transporter.sendMail({
    from: `"eduBUZZ" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `You've been invited to ${courseName}`,
    html,
  });
};

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
/*  POST /api/courses/:id/invite                                      */
/* ------------------------------------------------------------------ */

router.post("/:id/invite", requireAuth, async (req, res) => {
  const courseId = req.params.id;
  const { email } = req.body;
  const inviterId = req.user!.userId;
  const inviterRole = req.user!.role;
  const inviterName = req.user!.name || "Someone";

  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  // 1. Check if course exists and requester is enrolled or created it
  const { data: course } = await db.from("courses").select("*, enrollments(user_id)").eq("id", courseId).maybeSingle();
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const isEnrolled = course.enrollments?.some((e: any) => e.user_id === inviterId);
  const isCreator = course.created_by === inviterId;
  if (!isEnrolled && !isCreator) {
    res.status(403).json({ error: "You must be in the course to invite others" });
    return;
  }

  try {
    const adminDb = createAdminClient();
    const { data: { users }, error: listError } = await adminDb.auth.admin.listUsers();
    if (listError) throw listError;

    const invitee = users.find(u => u.email === email);
    if (!invitee) {
      res.status(404).json({ error: "No user found with this email" });
      return;
    }
    
    if (invitee.user_metadata?.role !== "student") {
      res.status(400).json({ error: "You can only invite students to a course" });
      return;
    }

    // Enroll the user
    const { error: enrollError } = await db.from("enrollments").insert({ user_id: invitee.id, course_id: courseId });
    if (enrollError) {
      if (enrollError.code === '23505') {
        res.status(400).json({ error: "User is already enrolled in this course" });
      } else {
        res.status(500).json({ error: "Failed to enroll user" });
      }
      return;
    }

    // Increment students count
    await db.from("courses").update({ students: course.students + 1 }).eq("id", courseId);

    // Send Email
    await sendInviteEmail(email, course.name, inviterName, inviterRole).catch(e => console.error("Email failed:", e));

    res.json({ ok: true });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
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
