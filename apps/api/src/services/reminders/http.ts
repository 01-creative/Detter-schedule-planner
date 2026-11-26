/** 带超时的 fetch：外部服务（微信/推送）挂住时不能拖死整个调度 tick。 */
export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 读取响应文本并截断，用于错误信息（不把整个 HTML 错误页塞进 reminders.error）。 */
export async function readErrorSnippet(response: Response, limit = 200): Promise<string> {
  try {
    const text = await response.text();
    return text.replace(/\s+/g, " ").trim().slice(0, limit);
  } catch {
    return "";
  }
}
