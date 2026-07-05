import { Router } from "express";
import { z } from "zod";
import db from "../db.js";
import { requireAuth, requireTutor } from "../middleware.js";

const router = Router();

/* ------------------------------------------------------------------ */
/*  GET /api/courses/:courseId/quizzes                                  */
/*  IMPORTANT: correct_index is NEVER sent to the client               */
/* ------------------------------------------------------------------ */

router.get("/courses/:courseId/quizzes", requireAuth, (req, res) => {
  const quizzes = db
    .prepare("SELECT * FROM quizzes WHERE course_id = ? ORDER BY due_day")
    .all(req.params.courseId) as any[];

  const userId = req.user!.userId;

  const result = quizzes.map((quiz) => {
    // Get questions WITHOUT correct_index
    const questions = db
      .prepare("SELECT id, question, answers_json, sort_order FROM quiz_questions WHERE quiz_id = ? ORDER BY sort_order")
      .all(quiz.id) as any[];

    const parsedQs = questions.map((q) => ({
      id: q.id,
      q: q.question,
      a: JSON.parse(q.answers_json),
      // NOTE: correct_index is intentionally omitted
    }));

    // Get user's best score
    const best = db
      .prepare("SELECT MAX(score_pct) as best FROM quiz_attempts WHERE quiz_id = ? AND user_id = ?")
      .get(quiz.id, userId) as any;

    return {
      id: quiz.id,
      courseId: quiz.course_id,
      title: quiz.title,
      dueDay: quiz.due_day,
      color: quiz.color,
      imageUrl: quiz.image_url,
      audioUrl: quiz.audio_url,
      qs: parsedQs,
      best: best?.best ?? null,
    };
  });

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

router.post("/courses/:courseId/quizzes", requireAuth, requireTutor, (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }

  const course = db.prepare("SELECT id FROM courses WHERE id = ?").get(req.params.courseId);
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const d = parsed.data;

  const insertQuiz = db.prepare(
    `INSERT INTO quizzes (course_id, title, due_day, color, image_url, audio_url, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertQuestion = db.prepare(
    `INSERT INTO quiz_questions (quiz_id, question, answers_json, correct_index, sort_order)
     VALUES (?, ?, ?, ?, ?)`
  );

  const createQuiz = db.transaction(() => {
    const result = insertQuiz.run(
      req.params.courseId,
      d.title,
      d.dueDay,
      d.color,
      d.imageUrl || null,
      d.audioUrl || null,
      req.user!.userId
    );
    const quizId = result.lastInsertRowid as number;

    d.questions.forEach((q, i) => {
      insertQuestion.run(quizId, q.q, JSON.stringify(q.a), q.c, i);
    });

    return quizId;
  });

  const quizId = createQuiz();

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

router.post("/quizzes/:id/answer", requireAuth, (req, res) => {
  const parsed = answerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const { questionId, answerIndex } = parsed.data;

  const question = db
    .prepare("SELECT correct_index, answers_json FROM quiz_questions WHERE id = ? AND quiz_id = ?")
    .get(questionId, Number(req.params.id)) as any;

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

router.post("/quizzes/:id/finish", requireAuth, (req, res) => {
  const parsed = finishSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const quizId = Number(req.params.id);
  const quiz = db.prepare("SELECT id FROM quizzes WHERE id = ?").get(quizId);
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found" });
    return;
  }

  db.prepare(
    "INSERT INTO quiz_attempts (quiz_id, user_id, score_pct) VALUES (?, ?, ?)"
  ).run(quizId, req.user!.userId, parsed.data.scorePct);

  // Return best score
  const best = db
    .prepare("SELECT MAX(score_pct) as best FROM quiz_attempts WHERE quiz_id = ? AND user_id = ?")
    .get(quizId, req.user!.userId) as any;

  res.json({ scorePct: parsed.data.scorePct, best: best?.best ?? parsed.data.scorePct });
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/quizzes/:id  (tutor only)                              */
/* ------------------------------------------------------------------ */

router.delete("/quizzes/:id", requireAuth, requireTutor, (req, res) => {
  const result = db.prepare("DELETE FROM quizzes WHERE id = ?").run(Number(req.params.id));
  if (result.changes === 0) {
    res.status(404).json({ error: "Quiz not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
