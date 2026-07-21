/* ------------------------------------------------------------------ */
/*  API fetch wrapper — credentials: 'include' for httpOnly cookies    */
/*  All API calls go through this to ensure consistent auth handling   */
/* ------------------------------------------------------------------ */

const BASE = "/api";

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

async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: "include", // always send httpOnly cookie
    headers: {
      "Content-Type": "application/json",
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
/*  Auth                                                               */
/* ------------------------------------------------------------------ */

export const api = {
  auth: {
    signup: (body: { name: string; email: string; password: string; role: string }) =>
      apiFetch<{ id: number; name: string; role: string }>("/auth/signup", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    login: (body: { email: string; password: string }) =>
      apiFetch<{ id: number; name: string; role: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    guest: (body: { name: string; passcode: string; role: string }) =>
      apiFetch<{ id: number; name: string; role: string }>("/auth/guest", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    logout: () => apiFetch("/auth/logout", { method: "POST" }),
    me: () => apiFetch<{ id: number; name: string; role: string }>("/auth/me"),
  },

  /* ------------------------------------------------------------------ */
  /*  Courses                                                            */
  /* ------------------------------------------------------------------ */

  courses: {
    list: () => apiFetch<any[]>("/courses"),
    create: (body: { name: string; goal: string; color?: string }) =>
      apiFetch<any>("/courses", { method: "POST", body: JSON.stringify(body) }),
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
    create: (courseId: string, body: { name: string; size?: string }) =>
      apiFetch<any>(`/courses/${courseId}/resources`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
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
