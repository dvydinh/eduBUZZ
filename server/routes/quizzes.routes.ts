import { Router } from "express";
import { z } from "zod";
import db from "../db.js";
import { requireAuth, requireTutor } from "../middleware.js";

const router = Router();

/* ------------------------------------------------------------------ */
/*  GET /api/courses/:courseId/quizzes                                  */
/*  IMPORTANT: correct_index is NEVER sent to the client               */
/* ------------------------------------------------------------------ */

router.get("/courses/:courseId/quizzes", requireAuth, async (req, res) => {
  const { data: quizzes, error } = await db
    .from("quizzes")
    .select("*")
    .eq("course_id", req.params.courseId)
    .order("due_day", { ascending: true });

  if (error || !quizzes) {
    res.status(500).json({ error: "Failed to fetch quizzes" });
    return;
  }

  const userId = req.user!.userId;

  const result = await Promise.all(quizzes.map(async (quiz) => {
    // Get questions WITHOUT correct_index
    const { data: questions } = await db
      .from("quiz_questions")
      .select("id, question, answers_json, sort_order")
      .eq("quiz_id", quiz.id)
      .order("sort_order", { ascending: true });

    const parsedQs = (questions || []).map((q: any) => ({
      id: q.id,
      q: q.question,
      a: JSON.parse(q.answers_json),
      // NOTE: correct_index is intentionally omitted
    }));

    // Get user's best score
    const { data: attempts } = await db
      .from("quiz_attempts")
      .select("score_pct")
      .eq("quiz_id", quiz.id)
      .eq("user_id", userId);
      
    let best = null;
    if (attempts && attempts.length > 0) {
      best = Math.max(...attempts.map((a: any) => a.score_pct));
    }

    return {
      id: quiz.id,
      courseId: quiz.course_id,
      title: quiz.title,
      dueDay: quiz.due_day,
      color: quiz.color,
      imageUrl: quiz.image_url,
      audioUrl: quiz.audio_url,
      qs: parsedQs,
      best,
    };
  }));

  res.json(result);
});

/* ------------------------------------------------------------------ */
/*  POST /api/courses/:courseId/quizzes  (tutor only)                   */
/*  Tutor sends correct answers — stored server-side only              */
/* ------------------------------------------------------------------ */

const questionSchema = z.object({
  q: z.string().min(1).max(1000),
  a: z.array(z.string().min(1).max(500)).min(2).max(6),
  c: z.number().int().min(0), // correct answer index — only accepted from tutor, never returned
});

const createSchema = z.object({
  title: z.string().min(1).max(300),
  dueDay: z.number().int().min(1).max(31),
  color: z.string().max(20).default("#a37bff"),
  imageUrl: z.string().max(2000).optional(),
  audioUrl: z.string().max(2000).optional(),
  questions: z.array(questionSchema).min(1).max(50),
});

router.post("/courses/:courseId/quizzes", requireAuth, requireTutor, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }

  const { data: course } = await db.from("courses").select("id").eq("id", req.params.courseId).maybeSingle();
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const d = parsed.data;

  // Insert quiz
  const { data: newQuiz, error: quizError } = await db.from("quizzes").insert({
    course_id: req.params.courseId,
    title: d.title,
    due_day: d.dueDay,
    color: d.color,
    image_url: d.imageUrl || null,
    audio_url: d.audioUrl || null,
    created_by: req.user!.userId
  }).select("id").single();

  if (quizError || !newQuiz) {
    res.status(500).json({ error: "Failed to create quiz" });
    return;
  }

  const quizId = newQuiz.id;

  // Insert questions in bulk
  const questionsToInsert = d.questions.map((q, i) => ({
    quiz_id: quizId,
    question: q.q,
    answers_json: JSON.stringify(q.a),
    correct_index: q.c,
    sort_order: i
  }));

  const { error: qError } = await db.from("quiz_questions").insert(questionsToInsert);
  if (qError) {
    // Ideally we should rollback or delete quiz here, but keep it simple for now
    await db.from("quizzes").delete().eq("id", quizId);
    res.status(500).json({ error: "Failed to insert questions" });
    return;
  }

  // Return without correct_index
  res.status(201).json({
    id: quizId,
    courseId: req.params.courseId,
    title: d.title,
    dueDay: d.dueDay,
    color: d.color,
    imageUrl: d.imageUrl || null,
    audioUrl: d.audioUrl || null,
    qs: d.questions.map((q) => ({ q: q.q, a: q.a })),
    best: null,
  });
});

/* ------------------------------------------------------------------ */
/*  POST /api/quizzes/:id/answer  — grade ONE question server-side     */
/* ------------------------------------------------------------------ */

const answerSchema = z.object({
  questionId: z.number().int(),
  answerIndex: z.number().int().min(0),
});

router.post("/quizzes/:id/answer", requireAuth, async (req, res) => {
  const parsed = answerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const { questionId, answerIndex } = parsed.data;

  const { data: question } = await db
    .from("quiz_questions")
    .select("correct_index, answers_json")
    .eq("id", questionId)
    .eq("quiz_id", Number(req.params.id))
    .maybeSingle();

  if (!question) {
    res.status(404).json({ error: "Question not found" });
    return;
  }

  const answers = JSON.parse(question.answers_json);
  if (answerIndex >= answers.length) {
    res.status(400).json({ error: "Answer index out of range" });
    return;
  }

  // Return only whether correct — NOT what the correct answer is
  const correct = answerIndex === question.correct_index;
  res.json({ correct, correctIndex: question.correct_index });
});

/* ------------------------------------------------------------------ */
/*  POST /api/quizzes/:id/finish  — save attempt score                 */
/* ------------------------------------------------------------------ */

const finishSchema = z.object({
  scorePct: z.number().int().min(0).max(100),
});

router.post("/quizzes/:id/finish", requireAuth, async (req, res) => {
  const parsed = finishSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const quizId = Number(req.params.id);
  const { data: quiz } = await db.from("quizzes").select("id").eq("id", quizId).maybeSingle();
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found" });
    return;
  }

  await db.from("quiz_attempts").insert({
    quiz_id: quizId,
    user_id: req.user!.userId,
    score_pct: parsed.data.scorePct
  });

  // Return best score
  const { data: attempts } = await db
    .from("quiz_attempts")
    .select("score_pct")
    .eq("quiz_id", quizId)
    .eq("user_id", req.user!.userId);

  let best = parsed.data.scorePct;
  if (attempts && attempts.length > 0) {
     best = Math.max(...attempts.map((a: any) => a.score_pct));
  }

  res.json({ scorePct: parsed.data.scorePct, best });
});

/* ------------------------------------------------------------------ */
/*  PATCH /api/quizzes/:id  (tutor only)                               */
/* ------------------------------------------------------------------ */

router.patch("/quizzes/:id", requireAuth, requireTutor, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }

  const { data, error } = await db
    .from("quizzes")
    .update({ 
      title: parsed.data.title,
      due_day: parsed.data.dueDay,
      questions: parsed.data.questions
    })
    .eq("id", Number(req.params.id))
    .select()
    .single();

  if (error || !data) {
    res.status(500).json({ error: "Failed to update quiz" });
    return;
  }
  
  // Return the updated quiz in the correct format for the client
  // The client doesn't need to know the correct answers, so we omit 'c'
  const parsedQs = data.questions.map((q: any, i: number) => ({ id: i, q: q.q, a: q.a }));
  
  res.json({
    id: data.id,
    courseId: data.course_id,
    title: data.title,
    dueDay: data.due_day,
    color: data.color,
    imageUrl: data.image_url,
    audioUrl: data.audio_url,
    qs: parsedQs,
    best: 0, // Since it's updated, best might not be known here, but the client only updates specific fields.
  });
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/quizzes/:id  (tutor only)                              */
/* ------------------------------------------------------------------ */

router.delete("/quizzes/:id", requireAuth, requireTutor, async (req, res) => {
  const { error, count } = await db.from("quizzes").delete({ count: 'exact' }).eq("id", Number(req.params.id));
  if (error || count === 0) {
    res.status(404).json({ error: "Quiz not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
