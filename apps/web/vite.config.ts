import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * 生成 SW 的预缓存清单（T13）。
 *
 * 为什么需要它：路由是 lazy 的，`/inbox` 这类页面的 chunk 只有在第一次访问后才会进缓存。
 * 不预缓存的话，装好应用、断网、再从深链打开一个没去过的页面，会撞上
 * 「Failed to fetch dynamically imported module」——离线可用就成了半句话。
 *
 * 做法：构建结束时把所有产物文件名写进 /precache-manifest.json，public/sw.js 在 install
 * 阶段读取它并一次性缓存。不引入任何依赖，也不用把哈希文件名硬编码进 SW。
 */
function precacheManifest(): Plugin {
  return {
    name: "detter-precache-manifest",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((file) => /\.(?:js|css|svg|png|woff2?)$/.test(file))
        .map((file) => `/${file}`)
        .sort();
      this.emitFile({
        type: "asset",
        fileName: "precache-manifest.json",
        source: JSON.stringify({ files }, null, 2),
      });
    },
  };
}

/**
 * 开发服务器把 /api 代理到本地后端（8787），这样浏览器里只有 5173 一个源，
 * Cookie 会话、CSRF 头都不需要处理跨域，和线上同源部署的行为保持一致。
 * 后端没起的时候只是代理 502，前端按「离线」降级，不会崩。
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), precacheManifest()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
    /**
     * Windows 上编辑器/工具常用「临时目录 + rename」原子写文件，
     * chokidar 会去 watch 那个临时的 `.xxx.tmpdir` 目录，随后的删除会抛 EBUSY 把 dev server 带崩。
     * 忽略这些中间产物，开发时就再也不会被别人的写文件动作打断。
     */
    watch: {
      ignored: ["**/.*.tmpdir/**", "**/*.tmp", "**/*.tmpdir/**"],
    },
    proxy: {
      "/api": {
        // 允许用环境变量改后端地址（本机 8787 常被别的服务占用时很有用）
        target: process.env.DETTER_API_TARGET ?? "http://127.0.0.1:8787",
        changeOrigin: false,
        // 后端没起时不要挂住请求：立刻回 502，前端据此进入「离线」而不是转圈
        configure: (proxy) => {
          proxy.on("error", (_error, _request, response) => {
            if (typeof response === "object" && "writeHead" in response && !response.headersSent) {
              response.writeHead(502, { "content-type": "application/json" });
            }
            if (typeof response === "object" && "end" in response) {
              response.end(
                JSON.stringify({
                  ok: false,
                  error: { code: "internal_error", message: "后端未启动（127.0.0.1:8787）" },
                }),
              );
            }
          });
        },
      },
    },
  },
  build: {
    /**
     * target 用 esnext 而不是 es2022，同样是为了绕开 Windows 上的一个构建抖动：
     * 只要 target 不是 esnext（或压缩器是 esbuild），Vite 就会用 esbuild 的 Go 进程
     * 再压缩一遍 chunk；它处理大文件时会先落临时文件，而本机 %TEMP% 的清理
     * （杀毒/索引）会偶发把它卡成 EPERM，表现为「压缩阶段随机失败」。
     * 这是单人用的现代浏览器应用，不需要向下兼容旧语法；terser 纯 JS 运行，
     * 没有临时文件，构建因此稳定可复现。
     */
    target: "esnext",
    minify: "terser",
    terserOptions: {
      compress: { passes: 2 },
      format: { comments: false },
    },
    // 首页 JS 控制在 250KB(gzip) 内：拆出 react / dexie / motion 三个长期缓存块
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          storage: ["dexie", "dexie-react-hooks"],
          motion: ["motion/react"],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
