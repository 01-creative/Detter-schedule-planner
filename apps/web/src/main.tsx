import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { App } from "./app/App";

const container = document.getElementById("root");
if (!container) {
  throw new Error("找不到 #root 挂载点");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * 注册 Service Worker。
 *
 * 只在生产构建里注册（T13）：dev server 下每个模块都是 `/src/xxx.tsx?t=<时间戳>`，
 * SW 的 stale-while-revalidate 会把这些地址越攒越多，改完代码还可能先拿到旧模块；
 * 开发时不需要离线能力，注册反而是干扰。
 *
 * 生产行为由 public/sw.js 定义：app shell 预缓存、静态资源 SWR、
 * `/api/**` 完全不缓存、离线时导航请求回落 index.html。
 * 注册失败（非安全上下文 / 隐私模式 / 浏览器不支持）静默忽略：
 * 只是少一层离线兜底，不该影响主流程，也不该在控制台留红字。
 */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => undefined);
  });
}
