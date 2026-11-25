/* Detter Service Worker
 *
 * 为什么手写而不是用 workbox 生成：
 * 这个应用离线要能用，而开发的验收场景（DevTools 里点 Offline）跑的是 dev server。
 * 手写一份「网络优先、失败回落缓存」的 SW，dev 与生产行为完全一致，也不会在 HMR 期间
 * 缓存住构建产物的哈希路径。API 请求一律绕过缓存，避免离线读取到过期的同步结果。
 */
const CACHE = "detter-app-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // 同步与鉴权必须实时，宁可失败也不能给旧数据
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // 只缓存成功且可复制的响应；opaque/重定向交给浏览器
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        // 导航请求离线时回落到应用外壳，前端自己会进「离线模式」
        if (request.mode === "navigate") {
          const shell = await caches.match("/index.html");
          if (shell) return shell;
        }
        return new Response("", { status: 504, statusText: "Offline" });
      }),
  );
});
