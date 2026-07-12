import db from "./db.js";
import { hashPassword } from "./auth.js";

const SAMPLE_PDF = "https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf";
const SAMPLE_AUDIO = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";

export async function seedIfEmpty() {
  const count = (db.prepare("SELECT COUNT(*) as n FROM users").get() as any).n;
  if (count > 0) return; // Already seeded

  console.log("🌱 Seeding demo data…");

  /* ---- Users ---- */
  const studentHash = await hashPassword("demo1234");
  const tutorHash = await hashPassword("demo1234");

  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)"
  ).run(1, "Demo Student", "student@edubuzz.app", studentHash, "student");

  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)"
  ).run(2, "Demo Tutor", "tutor@edubuzz.app", tutorHash, "tutor");

  /* ---- Courses ---- */
  const courses = [
    { id: "sat9", name: "SAT Sprint 500+", goal: "9-month roadmap", progress: 62, students: 4, color: "#ffcf3f" },
    { id: "algb", name: "Algebra Booster", goal: "Foundations", progress: 38, students: 6, color: "#a37bff" },
    { id: "rdwr", name: "Reading & Writing", goal: "Verbal mastery", progress: 74, students: 3, color: "#ff9db0" },
  ];
  const insertCourse = db.prepare(
    "INSERT INTO courses (id, name, goal, progress, students, color, created_by) VALUES (?, ?, ?, ?, ?, ?, 2)"
  );
  for (const c of courses) {
    insertCourse.run(c.id, c.name, c.goal, c.progress, c.students, c.color);
  }

  /* ---- Homework ---- */
  const hwData = [
    { course_id: "sat9", title: "Problem Set 8 (PDF)", due_day: 3, points: 20, description: "Work through the attached problem set on linear systems. Show all steps, then submit your solutions.", kind: "pdf", pdf_url: SAMPLE_PDF, status: "open", submissions: 2 },
    { course_id: "sat9", title: "Reflection note", due_day: 9, points: 5, description: "Write two sentences on what felt hardest this week.", kind: "line", pdf_url: null, status: "open", submissions: 0 },
    { course_id: "algb", title: "Factoring drills", due_day: 6, points: 15, description: "Complete drills 1–12.", kind: "line", pdf_url: null, status: "open", submissions: 1 },
    { course_id: "rdwr", title: "Vocab quizlet 12", due_day: 28, points: 10, description: "Study the 20 vocab cards.", kind: "line", pdf_url: null, status: "closed", submissions: 4 },
  ];
  const insertHW = db.prepare(
    "INSERT INTO homework (course_id, title, due_day, points, description, kind, pdf_url, status, submissions, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 2)"
  );
  for (const h of hwData) {
    insertHW.run(h.course_id, h.title, h.due_day, h.points, h.description, h.kind, h.pdf_url, h.status, h.submissions);
  }

  /* ---- Quizzes ---- */
  const insertQuiz = db.prepare(
    "INSERT INTO quizzes (course_id, title, due_day, color, image_url, audio_url, created_by) VALUES (?, ?, ?, ?, ?, ?, 2)"
  );
  const insertQ = db.prepare(
    "INSERT INTO quiz_questions (quiz_id, question, answers_json, correct_index, sort_order) VALUES (?, ?, ?, ?, ?)"
  );

  // Quiz 1
  const q1 = insertQuiz.run("sat9", "Warm-up: Linear Equations", 5, "#ffcf3f", null, null);
  insertQ.run(q1.lastInsertRowid, "Solve: 2x + 6 = 14", JSON.stringify(["x = 3", "x = 4", "x = 5"]), 1, 0);
  insertQ.run(q1.lastInsertRowid, "Slope of y = 3x − 2?", JSON.stringify(["−2", "3", "1/3"]), 1, 1);
  insertQ.run(q1.lastInsertRowid, "x-intercept of y = x − 5?", JSON.stringify(["(5, 0)", "(0, 5)", "(−5, 0)"]), 0, 2);

  // Quiz 2
  const q2 = insertQuiz.run("rdwr", "Listening Comprehension I", 19, "#a37bff", null, SAMPLE_AUDIO);
  insertQ.run(q2.lastInsertRowid, "After the clip, the main topic is…", JSON.stringify(["the main point", "the first line", "the longest word"]), 0, 0);
  insertQ.run(q2.lastInsertRowid, "Tone describes the speaker's…", JSON.stringify(["attitude", "font", "page count"]), 0, 1);

  // Quiz 3
  const q3 = insertQuiz.run("algb", "Grammar Rapid Round", 12, "#ff9db0", null, null);
  insertQ.run(q3.lastInsertRowid, "Pick the correct one:", JSON.stringify(["their going", "they're going", "there going"]), 1, 0);
  insertQ.run(q3.lastInsertRowid, 'Plural of "bee"?', JSON.stringify(["bees", "beies", "bee's"]), 0, 1);

  // Add a quiz attempt for demo student (best 88% on quiz 1)
  db.prepare("INSERT INTO quiz_attempts (quiz_id, user_id, score_pct) VALUES (?, 1, 88)").run(q1.lastInsertRowid);
  db.prepare("INSERT INTO quiz_attempts (quiz_id, user_id, score_pct) VALUES (?, 1, 72)").run(q2.lastInsertRowid);

  /* ---- Resources ---- */
  const resData = [
    { course_id: "sat9", name: "Chapter 3 — Slides.pdf", size: "2.4 MB" },
    { course_id: "sat9", name: "Formula Cheat Sheet.pdf", size: "640 KB" },
    { course_id: "algb", name: "Factoring guide.pdf", size: "880 KB" },
    { course_id: "rdwr", name: "Reading Passages.pdf", size: "1.1 MB" },
  ];
  const insertRes = db.prepare(
    "INSERT INTO resources (course_id, name, size, created_by) VALUES (?, ?, ?, 2)"
  );
  for (const r of resData) {
    insertRes.run(r.course_id, r.name, r.size);
  }

  /* ---- Reminders ---- */
  db.prepare("INSERT INTO reminders (user_id, day, label) VALUES (1, 15, 'Book study room')").run();

  console.log("✅ Demo data seeded (student@edubuzz.app / tutor@edubuzz.app, password: demo1234)");
}
