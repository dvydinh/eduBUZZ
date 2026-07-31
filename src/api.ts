/* ------------------------------------------------------------------ */
/*  API fetch wrapper — includes Authorization Bearer token           */
/* ------------------------------------------------------------------ */

import { io, Socket } from 'socket.io-client';
import { supabase } from './supabase';

const BASE = "/api";

let socketInstance: Socket | null = null;
export function getSocket() {
  if (!socketInstance) socketInstance = io({ path: '/socket.io/', autoConnect: false });
  return socketInstance;
}

interface ApiError {
  error: string;
  details?: unknown;
}

class ApiResponseError extends Error {
  status: number;
  body: ApiError;
  constructor(status: number, body: ApiError) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}

async function getHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  
  return headers;
}

async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const defaultHeaders = await getHeaders();
  
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json();

  if (!res.ok) {
    throw new ApiResponseError(res.status, data);
  }

  return data as T;
}

/* ------------------------------------------------------------------ */
/*  API                                                                */
/* ------------------------------------------------------------------ */

export const api = {
  /* ------------------------------------------------------------------ */
  /*  Courses                                                            */
  /* ------------------------------------------------------------------ */

  courses: {
    list: () => apiFetch<any[]>("/courses"),
    create: (body: { name: string; goal: string; color?: string }) =>
      apiFetch<any>("/courses", { method: "POST", body: JSON.stringify(body) }),
    join: (id: string) =>
      apiFetch(`/courses/${id}/join`, { method: "POST" }),
    invite: (id: string, email: string) =>
      apiFetch(`/courses/${id}/invite`, { method: "POST", body: JSON.stringify({ email }) }),
    remove: (id: string) =>
      apiFetch(`/courses/${id}`, { method: "DELETE" }),
  },

  /* ------------------------------------------------------------------ */
  /*  Homework                                                           */
  /* ------------------------------------------------------------------ */

  homework: {
    list: (courseId: string) =>
      apiFetch<any[]>(`/courses/${courseId}/homework`),
    create: (courseId: string, body: any) =>
      apiFetch<any>(`/courses/${courseId}/homework`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    submit: (id: number, fileName?: string) =>
      apiFetch(`/homework/${id}/submit`, {
        method: "POST",
        body: JSON.stringify({ fileName }),
      }),
    toggleClose: (id: number) =>
      apiFetch(`/homework/${id}/toggle-close`, { method: "PATCH" }),
    remove: (id: number) =>
      apiFetch(`/homework/${id}`, { method: "DELETE" }),
  },

  /* ------------------------------------------------------------------ */
  /*  Quizzes                                                            */
  /* ------------------------------------------------------------------ */

  quizzes: {
    list: (courseId: string) =>
      apiFetch<any[]>(`/courses/${courseId}/quizzes`),
    create: (courseId: string, body: any) =>
      apiFetch<any>(`/courses/${courseId}/quizzes`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    answer: (quizId: number, questionId: number, answerIndex: number) =>
      apiFetch<{ correct: boolean; correctIndex: number }>(
        `/quizzes/${quizId}/answer`,
        {
          method: "POST",
          body: JSON.stringify({ questionId, answerIndex }),
        }
      ),
    finish: (quizId: number, scorePct: number) =>
      apiFetch<{ scorePct: number; best: number }>(`/quizzes/${quizId}/finish`, {
        method: "POST",
        body: JSON.stringify({ scorePct }),
      }),
    remove: (quizId: number) =>
      apiFetch(`/quizzes/${quizId}`, { method: "DELETE" }),
  },

  /* ------------------------------------------------------------------ */
  /*  Resources                                                          */
  /* ------------------------------------------------------------------ */

  resources: {
    list: (courseId: string) =>
      apiFetch<any[]>(`/courses/${courseId}/resources`),
    create: async (courseId: string, body: FormData) => {
      const headers = await getHeaders();
      delete headers["Content-Type"]; // let browser set boundary
      return fetch(`${BASE}/courses/${courseId}/resources`, {
        method: "POST",
        headers,
        body,
      }).then((res) => {
        if (!res.ok) throw new Error("Failed");
        return res.json();
      });
    },
    remove: (id: number) =>
      apiFetch(`/resources/${id}`, { method: "DELETE" }),
  },

  /* ------------------------------------------------------------------ */
  /*  Reminders                                                          */
  /* ------------------------------------------------------------------ */

  reminders: {
    list: () => apiFetch<any[]>("/reminders"),
    create: (body: { day: number; label: string }) =>
      apiFetch<any>("/reminders", { method: "POST", body: JSON.stringify(body) }),
  },
};
