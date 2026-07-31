import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
// import { seedIfEmpty } from "./seed.js";

// Routes
import coursesRoutes from "./routes/courses.routes.js";
import homeworkRoutes from "./routes/homework.routes.js";
import quizzesRoutes from "./routes/quizzes.routes.js";
import resourcesRoutes from "./routes/resources.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_PROD = process.env.NODE_ENV === "production";
const app = express();
const PORT = parseInt(process.env.PORT || process.env.API_PORT || "3001");

/* ------------------------------------------------------------------ */
/*  Security middleware                                                */
/* ------------------------------------------------------------------ */

// Helmet: security headers (CSP, HSTS, etc.)
app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled for dev proxy

// CORS: allow Vite dev server + production frontend domain
const allowedOrigins = [
  "http://localhost:8443",
  "https://localhost:8443",
  `http://localhost:${process.env.PORT || 8443}`,
];
if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// Parse JSON bodies (limit size to prevent abuse)
app.use(express.json({ limit: "1mb" }));

// Parse cookies (for JWT httpOnly cookie)
app.use(cookieParser());

/* ------------------------------------------------------------------ */
/*  Routes                                                             */
/* ------------------------------------------------------------------ */

app.use("/api/courses", coursesRoutes);
app.use("/api", homeworkRoutes);   // /api/courses/:courseId/homework + /api/homework/:id/*
app.use("/api", quizzesRoutes);    // /api/courses/:courseId/quizzes + /api/quizzes/:id/*
app.use("/api", resourcesRoutes); // /api/courses/:courseId/resources + /api/resources/:id + /api/reminders

// Serve uploaded files statically
const uploadsDir = path.join(__dirname, '..', 'uploads');
import fs from 'node:fs';
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

/* ------------------------------------------------------------------ */
/*  Health check                                                       */
/* ------------------------------------------------------------------ */

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

/* ------------------------------------------------------------------ */
/*  Production: serve Vite-built frontend from dist/                   */
/* ------------------------------------------------------------------ */

if (IS_PROD) {
  const distPath = path.join(__dirname, "..", "dist");
  app.use(express.static(distPath));
  // SPA fallback: any non-API route → index.html
  app.use((_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

/* ------------------------------------------------------------------ */
/*  Global error handler — never leak stack traces                     */
/* ------------------------------------------------------------------ */

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("❌ Unhandled error:", err.message);
    if (process.env.NODE_ENV !== "production") {
      console.error(err.stack);
    }
    res.status(500).json({ error: "Internal server error" });
  }
);

/* ------------------------------------------------------------------ */
/*  Start                                                              */
/* ------------------------------------------------------------------ */

import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  }
});

io.on("connection", (socket) => {
  socket.on("join-room", (roomId: string, user: { name: string; muted: boolean; camOff: boolean }) => {
    socket.join(roomId);
    
    // Tell others in room that a new user joined
    socket.to(roomId).emit("user-joined", socket.id, user);

    // Relay WebRTC signaling messages
    socket.on("signal", (toId: string, signalData: any) => {
      io.to(toId).emit("signal", socket.id, signalData);
    });

    // Relay chat messages
    socket.on("chat-message", (msg: { who: string; msg: string }) => {
      io.to(roomId).emit("chat-message", msg);
    });

    // Relay status toggles (mute, cam, hand)
    socket.on("toggle-status", (status: { muted?: boolean; camOff?: boolean; hand?: boolean }) => {
      socket.to(roomId).emit("toggle-status", socket.id, status);
    });

    // Whiteboard Sync
    socket.on("wb-draw", (roomId: string, drawData: any) => {
      socket.to(roomId).emit("wb-draw", drawData);
    });
    
    socket.on("wb-clear", (roomId: string) => {
      socket.to(roomId).emit("wb-clear");
    });
    
    socket.on("wb-page", (roomId: string, pageNum: number) => {
      socket.to(roomId).emit("wb-page", pageNum);
    });

    socket.on("wb-type-live", (roomId: string, data: any) => {
      socket.to(roomId).emit("wb-type-live", data);
    });

    socket.on("wb-type-end", (roomId: string, id: string) => {
      socket.to(roomId).emit("wb-type-end", id);
    });

    socket.on("wb-set-pdf", (roomId: string, url: string) => {
      socket.to(roomId).emit("wb-set-pdf", url);
    });

    socket.on("wb-scroll", (roomId: string, scrollData: any) => {
      socket.to(roomId).emit("wb-scroll", scrollData);
    });

    socket.on("wb-request-state-broadcast", (roomId: string) => {
      // Find one user in the room to request state from (except the requester)
      socket.to(roomId).emit("wb-request-state", socket.id);
    });

    socket.on("wb-sync-state", (toId: string, state: any) => {
      io.to(toId).emit("wb-sync-state", state);
    });

    socket.on("leave-room", (room: string) => {
      socket.leave(room);
      socket.to(room).emit("user-left", socket.id);
    });

    socket.on("disconnect", () => {
      socket.to(roomId).emit("user-left", socket.id);
    });
  });
});

async function start() {
  await seedIfEmpty();

  httpServer.listen(PORT, () => {
    console.log(`🐝 eduBUZZ API & WebRTC Signaling running on http://localhost:${PORT}`);
    console.log(`   Security: JWT httpOnly cookies, bcrypt, role-based access`);
    console.log(`   Demo accounts: student@edubuzz.app / tutor@edubuzz.app (pw: demo1234)`);
  });
}

start().catch(console.error);
