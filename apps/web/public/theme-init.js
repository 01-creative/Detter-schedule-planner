/**
 * 首帧主题脚本（外部文件，不是内联脚本）。
 *
 * 为什么不在 index.html 里写内联 <script>：
 * 生产环境的 CSP 是 `script-src 'self'`（见 docs/architecture/05-SECURITY.md），
 * 内联脚本会被拦掉，深色用户会先看到一闪的白屏。放到 public/ 下由静态服务返回，
 * 既保留「主包下载前就跑完」的时序，又不用为 CSP 开 'unsafe-inline'。
 *
 * 本文件必须保持 ES5 语法且同步执行：它跑在任何模块之前。
 */
(function () {
  try {
    var saved = localStorage.getItem("detter.theme") || "system";
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var dark = saved === "dark" || (saved === "system" && prefersDark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (error) {
    document.documentElement.dataset.theme = "light";
  }
})();
