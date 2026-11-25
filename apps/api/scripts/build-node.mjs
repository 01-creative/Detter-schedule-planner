import { context } from "esbuild";

/**
 * 把 src/server.ts 打成单文件 ESM，供 `node dist/server.js` 运行。
 *
 * 为什么必须打包：@detter/shared 通过 workspace 链接进 node_modules，而 Node 的原生类型剥离
 * 拒绝处理 node_modules 下的 .ts 文件（ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING）。
 * 打包后 @detter/shared 与 zod 都成了产物的一部分，运行时不依赖 TS 解析。
 *
 * 只把 node: 内置模块留作外部依赖：其余第三方包（hono / zod / @hono/node-server）全部内联，
 * 避免部署时还要带 node_modules。
 */
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // 单个文件便于部署；sourcemap 保留行号，生产排查靠它
  sourcemap: true,
  sourcesContent: true,
  logLevel: "info",
  // 允许把 node: 内置模块排除；其它裸包一律打包进来
  external: ["node:*"],
  // esbuild 默认不会为 ESM 产物补齐 require/import.meta 的兼容垫片，这里显式声明 banner 无必要：
  // target=node22 下 import.meta.url 原生可用。
  banner: undefined,
};

if (watch) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  console.log("[build:node] watching src/** …");
} else {
  const ctx = await context(buildOptions);
  await ctx.rebuild();
  await ctx.dispose();
}
