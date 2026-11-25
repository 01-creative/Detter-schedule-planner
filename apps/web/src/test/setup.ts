import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * 测试环境约定：
 * - fake-indexeddb 提供 IndexedDB，Dexie 才能在 jsdom 里真实读写；
 * - 每个用例结束后清理 DOM，避免上一个组件的弹层残留在 document.body；
 * - matchMedia 在 jsdom 里也没有，主题与动效降级判断需要一个最小桩。
 */
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});
