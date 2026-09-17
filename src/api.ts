import type { Session, SyncEvent } from "./types";
interface Envelope<T> {
  success: boolean;
  code: string;
  message: string;
  data: T;
}
export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
let current: Session | null = null;
let refreshing: Promise<Session> | null = null;
const storage = "hello-travel.page-session.v1";
export function session(): Session | null {
  return current;
}
export function clearSession() {
  current = null;
  sessionStorage.removeItem(storage);
}
export function adoptSession(value: Session) {
  current = value;
  // 页面绑定值属于本页；访问令牌只在内存，不写localStorage。
  sessionStorage.setItem(
    storage,
    JSON.stringify({
      sid: value.sid,
      csrf: value.csrf,
      email: value.email,
      userId: value.userId,
    }),
  );
}
async function raw<T>(
  path: string,
  body?: unknown,
  bound = current,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (bound?.sid) headers["X-Session-ID"] = bound.sid;
  if (bound?.csrf) headers["X-CSRF-Token"] = bound.csrf;
  if (bound?.accessToken) headers.Authorization = `Bearer ${bound.accessToken}`;
  if (!(body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(`/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
    credentials: "same-origin",
  });
  const value: Envelope<T> = await response.json();
  if (!response.ok || !value.success)
    throw new ApiError(value.code, value.message, response.status);
  return value.data;
}
async function refresh(): Promise<Session> {
  if (!refreshing)
    refreshing = (async () => {
      const saved = sessionStorage.getItem(storage);
      if (!saved) throw new ApiError("UNAUTHORIZED", "请登录", 401);
      const bound = JSON.parse(saved) as Session;
      const value = await raw<Session>("/auth/refresh", {}, bound);
      if (value.sid !== bound.sid)
        throw new ApiError("SESSION_REPLACED", "当前页面登录已被替换", 401);
      adoptSession(value);
      return value;
    })().finally(() => {
      refreshing = null;
    });
  return refreshing;
}
export async function recoverSession(): Promise<Session | null> {
  if (!sessionStorage.getItem(storage)) return null;
  try {
    return await refresh();
  } catch {
    clearSession();
    return null;
  }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  try {
    return await raw<T>(path, body);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      error.code !== "SESSION_REPLACED" &&
      !path.startsWith("/auth/")
    ) {
      try {
        await refresh();
        return await raw<T>(path, body);
      } catch (retry) {
        clearSession();
        window.dispatchEvent(new Event("ht-session-ended"));
        throw retry;
      }
    }
    if (error instanceof ApiError && error.code === "SESSION_REPLACED") {
      clearSession();
      window.dispatchEvent(new Event("ht-session-ended"));
    }
    throw error;
  }
}
export async function stream(
  after: string,
  signal: AbortSignal,
  onEvent: (event: SyncEvent) => void,
) {
  const bound = current;
  if (!bound) return;
  const response = await fetch(
    `/api/v1/events?after=${encodeURIComponent(after)}`,
    {
      signal,
      credentials: "same-origin",
      headers: {
        Authorization: `Bearer ${bound.accessToken}`,
        "X-Session-ID": bound.sid,
      },
    },
  );
  if (response.status === 401) {
    await api("/sync?after=" + after);
    return;
  }
  if (!response.ok || !response.body) throw new Error("同步连接暂不可用");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      if (buffer.length > 262144) throw new Error("同步缓冲区超限");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (block.includes("event:reset")) return;
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5))
          .join("\n");
        if (data) onEvent(JSON.parse(data) as SyncEvent);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
