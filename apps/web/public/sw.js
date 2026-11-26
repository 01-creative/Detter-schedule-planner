/* Detter Service Worker · T13
 *
 * 为什么手写而不是用 workbox 生成：
 * 这个应用离线要能用，而我们没有引入 vite-plugin-pwa 之外的构建期 SW 生成链；
 * 手写一份策略明确的 SW，行为在 dev / preview / 生产完全一致，也便于逐条读代码。
 *
 * 策略（对应任务书 T13 §3）：
 *   1. app shell 预缓存：/ 、/index.html、manifest、图标。首个版本装好即可离线打开。
 *   2. 导航请求：network-first（在线永远拿最新 HTML），离线回落缓存，再回落 /index.html。
 *      单页应用的 /inbox 这类路径服务端没有实体文件，回落 index.html 才能保住路由。
 *   3. 静态资源：stale-while-revalidate（先给缓存，同时后台刷新）。
 *   4. /api/**：完全不拦截（network-only）。同步与鉴权宁可失败，也不能读到旧响应。
 */

const VERSION = "v4";
const SHELL_CACHE = `detter-shell-${VERSION}`;
const ASSET_CACHE = `detter-assets-${VERSION}`;
const KEEP = new Set([SHELL_CACHE, ASSET_CACHE]);

const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/maskable-512.png",
  "/apple-touch-180.png",
];

/** 单个资源失败不应让整个安装失败：少一个图标也要能离线打开应用。 */
async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(
    SHELL.map((url) =>
      cache.add(new Request(url, { cache: "reload" })).catch((error) => {
        console.warn("[sw] 预缓存失败", url, error?.message ?? error);
      }),
    ),
  );
}

/** 构建产物清单由 vite.config.ts 的 precacheManifest 插件写出（含懒加载路由的 chunk）。 */
async function readBuildManifest() {
  try {
    const response = await fetch(`/precache-manifest.json?ts=${Date.now()}`, { cache: "reload" });
    if (!response.ok) return [];
    const parsed = await response.json();
    return Array.isArray(parsed?.files) ? parsed.files : [];
  } catch {
    // dev 或老版本产物没有这个文件：退化成「只预缓存外壳」，导航仍然可用
    return [];
  }
}

/**
 * 预缓存全部构建产物，并清掉上一次构建遗留的哈希文件，避免缓存无限长大。
 *
 * 两个细节：
 * - 清单为空（dev、老产物、或 SW 在离线状态被重新安装）时**不动缓存**。
 *   否则一次拿不到清单就会把已经缓存的产物全删了，离线能力瞬间归零。
 * - 先写入新产物，再删旧文件：中间没有「缓存里缺一块」的窗口。
 */
async function precacheAssets() {
  const files = await readBuildManifest();
  if (files.length === 0) return;

  const cache = await caches.open(ASSET_CACHE);
  await Promise.all(
    files.map((file) =>
      cache.add(new Request(file, { cache: "reload" })).catch((error) => {
        console.warn("[sw] 产物预缓存失败", file, error?.message ?? error);
      }),
    ),
  );

  const keep = new Set(files);
  for (const request of await cache.keys()) {
    const pathname = new URL(request.url).pathname;
    if (!keep.has(pathname)) await cache.delete(request);
  }
}

function precache() {
  return Promise.all([precacheShell(), precacheAssets()]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !KEEP.has(key)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

/** 只缓存「成功、同源、basic」的响应；opaque / 重定向交给浏览器自己处理。 */
function cacheable(response) {
  return response.ok && response.type === "basic";
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    // 归一化：所有导航共用缓存里的 index.html，离线时任何路由都能回落到同一份外壳。
    if (cacheable(response)) {
      const copy = response.clone();
      caches
        .open(SHELL_CACHE)
        .then((cache) => cache.put("/index.html", copy))
        .catch(() => undefined);
    }
    return response;
  } catch {
    // ignoreVary：dev/preview 的静态服务会给响应加 `Vary: Origin`，
    // 而 SW 自己发起的预缓存请求不带 Origin。不忽略 Vary 的话，
    // 「缓存里有、但按请求头匹配不上」——离线打开深链会 504。
    const cached = await caches.match(request, { ignoreSearch: true, ignoreVary: true });
    if (cached) return cached;
    const shell = await caches.match("/index.html", { ignoreSearch: true, ignoreVary: true });
    if (shell) return shell;
    return new Response(
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Detter · 离线</title>
       <body style="font:15px/1.6 system-ui;padding:32px;color:#1c1917">
       <h1 style="font-size:18px">现在打不开 Detter</h1>
       <p>离线缓存里还没有应用外壳。连上网络后重新打开一次即可。</p></body></html>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(ASSET_CACHE);
  // 同上：静态资源按 URL 缓存，不应因为 Vary: Origin 的请求头差异而 miss
  const cached = await cache.match(request, { ignoreVary: true });

  const network = fetch(request)
    .then((response) => {
      if (cacheable(response)) void cache.put(request, response.clone()).catch(() => undefined);
      return response;
    })
    .catch(() => undefined);

  // 命中了缓存也要让 SW 活到后台刷新写完，否则关页时可能半途被终止
  event.waitUntil(network);

  if (cached) return cached;

  const response = await network;
  if (response) return response;
  return new Response("", { status: 504, statusText: "Offline" });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 同步 / 鉴权 / 分享链接全部走网络，绝不缓存
  if (url.pathname.startsWith("/api/")) return;
  // SW 自身不缓存，否则更新会被卡住
  if (url.pathname === "/sw.js") return;
  // manifest 走网络：它决定「装到主屏后叫什么、图标是哪个」，宁可多一次请求也不要读到旧版本
  if (url.pathname === "/manifest.webmanifest") return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, event));
});
