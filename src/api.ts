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
    // 1. 发布当前状态或连接结果，后续页面操作使用最新快照。
    super(message);
    // 2. 发布当前状态或连接结果，后续页面操作使用最新快照。
    this.code = code;
    // 3. 发布当前状态或连接结果，后续页面操作使用最新快照。
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
  // 1. 发布当前状态或连接结果，后续页面操作使用最新快照。
  current = null;
  // 2. 发布当前状态或连接结果，后续页面操作使用最新快照。
  sessionStorage.removeItem(storage);
}
export function adoptSession(value: Session) {
  // 1. 发布当前状态或连接结果，后续页面操作使用最新快照。
  current = value;
  // 页面绑定值属于本页；访问令牌只在内存，不写localStorage。
  // 2. 发布当前状态或连接结果，后续页面操作使用最新快照。
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
  // 1. 固定headers: Record<string, string>对应的本次操作状态，避免异步处理跨越页面生命周期。
  const headers: Record<string, string> = {};
  // 2. 处理当前前置条件或恢复分支，失效状态不继续执行。
  if (bound?.sid) headers["X-Session-ID"] = bound.sid;
  // 3. 处理当前前置条件或恢复分支，失效状态不继续执行。
  if (bound?.csrf) headers["X-CSRF-Token"] = bound.csrf;
  // 4. 处理当前前置条件或恢复分支，失效状态不继续执行。
  if (bound?.accessToken) headers.Authorization = `Bearer ${bound.accessToken}`;
  // 5. 处理当前前置条件或恢复分支，失效状态不继续执行。
  if (!(body instanceof FormData)) headers["Content-Type"] = "application/json";
  // 6. 取得服务端响应，随后核对HTTP状态与标准结果。
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
  // 7. 核对HTTP状态与标准结果，失败反馈给当前操作。
  if (!response.ok || !value.success)
    throw new ApiError(value.code, value.message, response.status);
  // 8. 交付本段结果或清理函数，由调用方承接后续生命周期。
  return value.data;
}
async function refresh(): Promise<Session> {
  // 1. 处理当前前置条件或恢复分支，失效状态不继续执行。
  if (!refreshing)
    refreshing = (async () => {
      // 1. 固定saved对应的本次操作状态，避免异步处理跨越页面生命周期。
      const saved = sessionStorage.getItem(storage);
      // 2. 处理当前前置条件或恢复分支，失效状态不继续执行。
      if (!saved) throw new ApiError("UNAUTHORIZED", "请登录", 401);
      // 3. 固定bound对应的本次操作状态，避免异步处理跨越页面生命周期。
      const bound = JSON.parse(saved) as Session;
      const value = await raw<Session>("/auth/refresh", {}, bound);
      // 4. 处理当前前置条件或恢复分支，失效状态不继续执行。
      if (value.sid !== bound.sid)
        throw new ApiError("SESSION_REPLACED", "当前页面登录已被替换", 401);
      // 5. 绑定本页面的新会话SID和CSRF证明。
      adoptSession(value);
      // 6. 交付本段结果或清理函数，由调用方承接后续生命周期。
      return value;
    })().finally(() => {
      refreshing = null;
    });
  // 2. 交付本段结果或清理函数，由调用方承接后续生命周期。
  return refreshing;
}
export async function recoverSession(): Promise<Session | null> {
  // 1. 处理当前前置条件或恢复分支，失效状态不继续执行。
  if (!sessionStorage.getItem(storage)) return null;
  // 2. 在失败反馈与资源清理边界内完成当前操作。
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
        // 1. 发布当前状态或连接结果，后续页面操作使用最新快照。
        await refresh();
        // 2. 交付本段结果或清理函数，由调用方承接后续生命周期。
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
  // 1. 固定bound对应的本次操作状态，避免异步处理跨越页面生命周期。
  const bound = current;
  // 2. 处理当前前置条件或恢复分支，失效状态不继续执行。
  if (!bound) return;
  // 3. 取得服务端响应，随后核对HTTP状态与标准结果。
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
  // 4. 核对HTTP状态与标准结果，失败反馈给当前操作。
  if (response.status === 401) {
    await api("/sync?after=" + after);
    return;
  }
  // 5. 处理当前前置条件或恢复分支，失效状态不继续执行。
  if (!response.ok || !response.body) throw new Error("同步连接暂不可用");
  // 6. 固定reader对应的本次操作状态，避免异步处理跨越页面生命周期。
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // 7. 在失败反馈与资源清理边界内完成当前操作。
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
