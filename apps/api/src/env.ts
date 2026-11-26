import type { Db } from "./db/types";
import type { ApiScope } from "@detter/shared";
import type { VapidCredentials } from "./services/reminders/types";

/**
 * Workers 绑定（与 wrangler.toml 的 [vars] / .dev.vars 对齐）。
 * Node 入口不读这个类型，但保留它作为两套运行时配置项的单一清单。
 */
export interface WorkerEnv {
  DB: D1Database;
  SETUP_TOKEN?: string;
  APP_ORIGIN?: string;
  APP_VERSION?: string;
  COOKIE_SECURE?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  /** 逗号分隔的额外 push endpoint 域名后缀（自建推送服务时用） */
  PUSH_ENDPOINT_ALLOWLIST?: string;
}

export interface AppConfig {
  /** 首次初始化的一次性口令；为空表示不允许 setup（生产上初始化后应移除）。 */
  setupToken: string;
  version: string;
  /** 生产站点 origin，用于 CSRF 的 Origin 白名单与 CORS。 */
  appOrigin: string;
  allowedOrigins: string[];
  /** 生产为 true：Cookie 加 Secure，并改用 __Host- 前缀。 */
  secureCookies: boolean;
  cookieName: string;
}

/**
 * 本地开发前端 origin。
 *
 * 为什么硬编码也安全：CSRF 的 Origin 白名单只是纵深防御的一层，
 * 真正的门槛是 x-detter-csrf 请求头（跨站页面无法设置）。
 * 这两个 origin 只在攻击者已经能在你本机 5173 端口跑页面时才有意义。
 */
export const DEV_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:4173"];

export const DEFAULT_VERSION = "0.1.0";

export interface ConfigInput {
  setupToken?: string;
  version?: string;
  appOrigin?: string;
  secureCookies?: boolean;
  extraOrigins?: string[];
}

export function createConfig(input: ConfigInput = {}): AppConfig {
  const appOrigin = input.appOrigin?.trim() || "http://127.0.0.1:5173";
  const secureCookies = input.secureCookies ?? false;
  const allowedOrigins = [...new Set([appOrigin, ...DEV_ORIGINS, ...(input.extraOrigins ?? [])])];
  return {
    setupToken: input.setupToken?.trim() ?? "",
    version: input.version?.trim() || DEFAULT_VERSION,
    appOrigin,
    allowedOrigins,
    secureCookies,
    // __Host- 前缀要求 Secure + Path=/ + 不带 Domain，浏览器会强制校验；
    // 本地 http 调试带 Secure 会导致 Cookie 写不进去，所以按环境切换名字。
    cookieName: secureCookies ? "__Host-detter_session" : "detter_session",
  };
}

export function readWorkerConfig(env: WorkerEnv): AppConfig {
  const secureCookies = env.COOKIE_SECURE === undefined ? true : env.COOKIE_SECURE !== "false";
  return createConfig({
    setupToken: env.SETUP_TOKEN,
    version: env.APP_VERSION,
    appOrigin: env.APP_ORIGIN,
    secureCookies,
  });
}

export function readNodeConfig(env: Record<string, string | undefined>): AppConfig {
  const production = env.NODE_ENV === "production";
  return createConfig({
    setupToken: env.SETUP_TOKEN,
    version: env.APP_VERSION,
    appOrigin: env.APP_ORIGIN,
    secureCookies: env.COOKIE_SECURE === undefined ? production : env.COOKIE_SECURE === "true",
  });
}

/* -------------------------------------------------------------------------- */
/*                              提醒/推送运行时依赖                              */
/* -------------------------------------------------------------------------- */

/** VAPID 环境变量的读取方式：Workers 从绑定读，Node 从 process.env 读。 */
export interface PushDepsInput {
  vapid?: VapidCredentials | null;
  fetch?: typeof fetch;
  endpointAllowlist?: string[];
}

export interface ResolvedPushDeps {
  vapid: VapidCredentials | null;
  fetch: typeof fetch;
  endpointAllowlist: string[];
}

function vapidFrom(publicKey: string | undefined, privateKey: string | undefined, subject: string | undefined): VapidCredentials | null {
  const pub = (publicKey ?? "").trim();
  const priv = (privateKey ?? "").trim();
  if (!pub || !priv) return null;
  return { publicKey: pub, privateKey: priv, subject: (subject ?? "").trim() };
}

export function readWorkerPushDeps(env: WorkerEnv): ResolvedPushDeps {
  return {
    vapid: vapidFrom(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT),
    fetch: (input, init) => fetch(input, init),
    endpointAllowlist: splitAllowlist(env.PUSH_ENDPOINT_ALLOWLIST),
  };
}

export function readNodePushDeps(env: Record<string, string | undefined>): ResolvedPushDeps {
  return {
    vapid: vapidFrom(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT),
    fetch: (input, init) => fetch(input, init),
    endpointAllowlist: splitAllowlist(env.PUSH_ENDPOINT_ALLOWLIST),
  };
}

function splitAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

/** 创建应用所需的全部依赖，由各运行时入口注入（app.ts 不读 process.env / 全局变量）。 */
export interface AppDeps {
  db: Db;
  config: AppConfig;
  runtime: "workers" | "node";
  /** 可注入时钟：测试里需要控制「过期」「时钟偏差」这类场景。 */
  now?: () => number;
  /** 提醒调度用：VAPID 密钥、fetch（测试可替换）、push endpoint 白名单 */
  push?: PushDepsInput;
}

export type ResolvedDeps = AppDeps & { now: () => number; push: ResolvedPushDeps };

/**
 * 请求身份上下文。
 *
 * Cookie 会话天然拥有全部 scope（人本人）；API Key 按签发时的 scope 收窄。
 * sessionId / apiKeyId 让「改密码踢会话」「审计留痕」这类操作有据可依。
 */
export interface AuthContext {
  userId: string;
  deviceId: string | null;
  via: "cookie" | "apikey";
  scopes: ApiScope[];
  sessionId: string | null;
  apiKeyId: string | null;
}

export interface AppVariables {
  requestId: string;
  auth: AuthContext | null;
  startedAt: number;
}

/** Hono 上下文类型：Bindings 是运行时绑定，Variables 是本进程解析出的请求级状态。 */
export interface AppEnv {
  Bindings: WorkerEnv;
  Variables: AppVariables;
}
