import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let DB_PATH = path.join(__dirname, "edubuzz.db");

// In production, save DB to the /app/data folder so it can be safely mounted to a Volume
if (process.env.NODE_ENV === "production") {
  const dataDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  DB_PATH = path.join(dataDir, "edubuzz.db");
}

const db = new Database(DB_PATH);

// WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/* ------------------------------------------------------------------ */
/*  Schema                                                             */
/* ------------------------------------------------------------------ */

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    email       TEXT    UNIQUE,
    password_hash TEXT,
    role        TEXT    NOT NULL CHECK(role IN ('student','tutor')),
    is_guest    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS courses (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    goal        TEXT    NOT NULL DEFAULT '',
    progress    INTEGER NOT NULL DEFAULT 0,
    students    INTEGER NOT NULL DEFAULT 0,
    color       TEXT    NOT NULL DEFAULT '#ffcf3f',
    created_by  INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS homework (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id   TEXT    NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    due_day     INTEGER NOT NULL,
    points      INTEGER NOT NULL DEFAULT 0,
    description TEXT    NOT NULL DEFAULT '',
    kind        TEXT    NOT NULL DEFAULT 'line' CHECK(kind IN ('line','pdf')),
    pdf_url     TEXT,
    image_url   TEXT,
    audio_url   TEXT,
    status      TEXT    NOT NULL DEFAULT 'open' CHECK(status IN ('open','submitted','closed')),
    submissions INTEGER NOT NULL DEFAULT 0,
    created_by  INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS hw_submissions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    homework_id INTEGER NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    file_name   TEXT,
    submitted_at TEXT   NOT NULL DEFAULT (datetime('now')),
    UNIQUE(homework_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS quizzes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id   TEXT    NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    due_day     INTEGER NOT NULL,
    color       TEXT    NOT NULL DEFAULT '#a37bff',
    image_url   TEXT,
    audio_url   TEXT,
    created_by  INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS quiz_questions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id        INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    question       TEXT    NOT NULL,
    answers_json   TEXT    NOT NULL,
    correct_index  INTEGER NOT NULL,
    sort_order     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS quiz_attempts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id     INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    score_pct   INTEGER NOT NULL,
    attempted_at TEXT   NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS resources (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id   TEXT    NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    size        TEXT    NOT NULL DEFAULT '0 KB',
    created_by  INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    day         INTEGER NOT NULL,
    label       TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS enrollments (
    user_id     INTEGER NOT NULL REFERENCES users(id),
    course_id   TEXT    NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    joined_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, course_id)
  );
`);

export default db;
