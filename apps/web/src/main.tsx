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
 * 生产的离线能力靠它；开发环境也同样注册，因为验收要在 DevTools 的 Offline 下刷新，
 * 没有 SW 的话连应用外壳都加载不出来。sw.js 采用「网络优先、失败回落缓存」，
 * 在线时永远拿最新代码，不会让开发时的改动卡在缓存里。
 */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // 注册失败（例如非安全上下文）不影响主流程，只是少一层离线兜底
    });
  });
}
