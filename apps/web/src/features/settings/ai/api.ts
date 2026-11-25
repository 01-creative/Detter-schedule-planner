import type { ApiKeyCreated, ApiKeyInfo, ApiScope, ContextRange } from "@detter/shared";
import { api } from "@/lib/api";

/**
 * AI 接入层的请求封装。
 *
 * 密钥管理走已有的 /api/v1/api-keys（admin scope，浏览器 Cookie 会话）；
 * MCP 配置片段与上下文包是给「外部 AI」用的，不需要浏览器带 Cookie 也能用，
 * 但设置页里复制出来的片段必须带上密钥明文——它只存在于内存，刷新即消失。
 */

export interface CreateApiKeyInput {
  name: string;
  scopes: ApiScope[];
  expiresInDays?: number;
}

export async function listApiKeys(): Promise<ApiKeyInfo[]> {
  const data = await api.get<{ items: ApiKeyInfo[] }>("/api-keys");
  return data.items;
}

export async function createApiKey(input: CreateApiKeyInput): Promise<ApiKeyCreated> {
  return api.post<ApiKeyCreated>("/api-keys", input);
}

export async function revokeApiKey(id: string): Promise<void> {
  await api.delete<{ id: string; revokedAt: number }>(`/api-keys/${encodeURIComponent(id)}`);
}

const MCP_PATH = "/api/v1/mcp";

export function mcpEndpointUrl(): string {
  if (typeof window === "undefined") return MCP_PATH;
  return `${window.location.origin}${MCP_PATH}`;
}

/** Claude Desktop / Cursor 的配置结构一致（见 06-AI-INTEGRATION.md §3.2）。 */
export function buildMcpConfig(apiKey: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        detter: {
          type: "http",
          url: mcpEndpointUrl(),
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      },
    },
    null,
    2,
  );
}

export const MCP_KEY_PLACEHOLDER = "dtk_xxxxxxxx_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy";

/** 上下文包 markdown 不是 JSON 信封，单独用 fetch 取纯文本。 */
export async function fetchContextPackMarkdown(range: ContextRange): Promise<string> {
  const response = await fetch(`/api/v1/context/pack?range=${range}&format=markdown`, {
    method: "GET",
    credentials: "same-origin",
    headers: { accept: "text/markdown" },
  });
  if (!response.ok) {
    throw new Error(`上下文包生成失败（${response.status}）`);
  }
  return response.text();
}

/** 统一把未知异常转成一句可展示的话。 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "操作失败，请稍后重试";
}
