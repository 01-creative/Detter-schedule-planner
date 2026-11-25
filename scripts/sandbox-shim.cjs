/**
 * 受限环境 shim（Windows 沙箱 / 无子进程权限的 CI 容器）。
 *
 * 背景：某些沙箱环境会禁止创建命名管道，导致 `child_process.spawn` **同步抛出**
 * `EPERM`。而 Node 的契约是「spawn 失败通过 callback/error 事件异步通知」，
 * 于是像 Vite 这种 `exec("net use", cb)` 的探测代码会因为同步异常直接炸掉，
 * 连带 vitest / vite build 全部失败。
 *
 * 本 shim 把同步抛错转成异步回调错误，恢复 Node 的正常语义。
 * 在普通开发机上它是完全空操作，不会改变任何行为。
 *
 * 用法：node --require ./scripts/sandbox-shim.cjs <entry>
 */
const cp = require("node:child_process");

function once(fn) {
  let done = false;
  return (...args) => {
    if (done) return;
    done = true;
    fn(...args);
  };
}

function wrapCallbackStyle(name) {
  const original = cp[name];
  if (typeof original !== "function" || original.__detterShimmed) return;

  const wrapped = function patched(...args) {
    try {
      return original.apply(this, args);
    } catch (error) {
      const callback = args.find((arg) => typeof arg === "function");
      if (callback) {
        const cb = once(callback);
        process.nextTick(() => cb(error, "", ""));
        return undefined;
      }
      throw error;
    }
  };

  wrapped.__detterShimmed = true;
  cp[name] = wrapped;
}

wrapCallbackStyle("exec");
wrapCallbackStyle("execFile");
