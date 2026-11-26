import type { Notifier, NotifierContext, ReminderPayload } from "../types";
import { fetchWithTimeout, readErrorSnippet } from "../http";
import { resolveWechatProvider } from "../config";

/**
 * 微信推送渠道（PushPlus / Server酱）。
 *
 * 为什么选它们：国内 Web Push 依赖 FCM，Android Chrome 大量机型收不到；
 * 而 PushPlus/Server酱 走微信公众号/服务号模板消息，不依赖 Google 服务。
 *
 * 两个约束：
 * 1. 不把 token 写进任何日志/错误信息（错误里只出现服务名 + HTTP 状态 + 服务返回的 msg）；
 * 2. 服务返回的 code 必须校验：PushPlus 用 HTTP 200 + code 200 表示成功，
 *    只看 HTTP 状态会把「token 无效」当成成功。
 */

const WECHAT_TIMEOUT_MS = 10_000;

export const PUSHPLUS_ENDPOINT = "https://www.pushplus.plus/send";
export const SERVERCHAN_ENDPOINT = "https://sctapi.ftqq.com";

interface PushPlusResponse {
  code?: number;
  msg?: string;
  message?: string;
}

interface ServerChanResponse {
  code?: number;
  message?: string;
  data?: unknown;
}

/** 失败信息里的 token 一律打码（服务商有时会把 token 回显在 msg 里）。 */
function sanitize(message: string, token: string): string {
  const trimmed = message.trim().slice(0, 200);
  if (!token) return trimmed;
  return trimmed.split(token).join("***");
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function sendPushPlus(
  payload: ReminderPayload,
  token: string,
  ctx: NotifierContext,
): Promise<{ ok: boolean; error?: string; permanent?: boolean }> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      ctx.fetch,
      PUSHPLUS_ENDPOINT,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          title: payload.title,
          content: `${payload.body}\n\n${payload.url}`,
          template: "txt",
          channel: "wechat",
        }),
      },
      WECHAT_TIMEOUT_MS,
    );
  } catch (error) {
    return {
      ok: false,
      error: sanitize(`pushplus: 请求失败 ${error instanceof Error ? error.message : String(error)}`, token),
    };
  }

  if (!response.ok) {
    const snippet = await readErrorSnippet(response);
    return {
      ok: false,
      error: sanitize(`pushplus: HTTP ${response.status} ${snippet}`, token),
      // 4xx 中除 429 外都是配置问题（token 失效等），重试没有意义
      permanent: response.status >= 400 && response.status < 500 && response.status !== 429,
    };
  }

  const body = parseJson(await readErrorSnippet(response, 500)) as PushPlusResponse | null;
  if (!body) return { ok: false, error: "pushplus: 响应不是 JSON" };
  if (body.code !== 200) {
    // 业务码失败（token 失效、余额不足等）按临时失败处理：先重试 2 次再降级，
    // 避免把「刚好赶上服务商抖动」误判成永久故障。
    return {
      ok: false,
      error: sanitize(`pushplus: code=${String(body.code)} ${body.msg ?? body.message ?? ""}`, token),
    };
  }
  return { ok: true };
}

async function sendServerChan(
  payload: ReminderPayload,
  token: string,
  ctx: NotifierContext,
): Promise<{ ok: boolean; error?: string; permanent?: boolean }> {
  const url = `${SERVERCHAN_ENDPOINT}/${encodeURIComponent(token)}.send`;
  let response: Response;
  try {
    response = await fetchWithTimeout(
      ctx.fetch,
      url,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
        body: new URLSearchParams({
          title: payload.title,
          desp: `### ${payload.title}\n\n${payload.body}\n\n[打开 Detter](${payload.url})`,
        }).toString(),
      },
      WECHAT_TIMEOUT_MS,
    );
  } catch (error) {
    return {
      ok: false,
      error: sanitize(`serverchan: 请求失败 ${error instanceof Error ? error.message : String(error)}`, token),
    };
  }

  if (!response.ok) {
    const snippet = await readErrorSnippet(response);
    return {
      ok: false,
      error: sanitize(`serverchan: HTTP ${response.status} ${snippet}`, token),
      permanent: response.status >= 400 && response.status < 500 && response.status !== 429,
    };
  }

  const body = parseJson(await readErrorSnippet(response, 500)) as ServerChanResponse | null;
  if (!body) return { ok: false, error: "serverchan: 响应不是 JSON" };
  if (body.code !== 0) {
    return {
      ok: false,
      error: sanitize(`serverchan: code=${String(body.code)} ${body.message ?? ""}`, token),
    };
  }
  return { ok: true };
}

export const wechatNotifier: Notifier = {
  id: "wechat",
  async send(payload, ctx) {
    const token = ctx.config.wechatToken.trim();
    if (!token) {
      return { ok: false, permanent: true, error: "未配置微信推送 token" };
    }
    const provider = resolveWechatProvider(ctx.config.wechatProvider, token);
    return provider === "serverchan" ? sendServerChan(payload, token, ctx) : sendPushPlus(payload, token, ctx);
  },
};
