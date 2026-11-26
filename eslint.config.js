import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * ESLint 基线的两条原则：
 * 1. 只 lint「会被提交的产品代码」——临时脚本、QA 产物、构建产物一律忽略；
 * 2. TypeScript 文件交给 tsc 管类型与未定义变量（no-undef 在 TS 里会误报，
 *    官方建议对 TS 关闭），JS/Node 脚本再用一套最小 globals 兜住。
 */
const NODE_GLOBALS = {
  process: "readonly",
  console: "readonly",
  require: "readonly",
  module: "readonly",
  exports: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  fetch: "readonly",
  crypto: "readonly",
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/*.d.ts",
      // 临时目录与 QA 产物（agent 跑验证时留下的脚本/打包产物），不属于产品代码
      ".tmp/**",
      ".qa/**",
      "**/.tmp-worker/**",
      "apps/api/dist/**",
      "apps/web/dist/**",
      // Service Worker 有自己的运行环境（self / caches / clients），单独处理
      "apps/web/public/sw.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      // 两个规则都在代码里被 eslint-disable 引用过，必须注册，否则会报 "Definition for rule not found"
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // TypeScript 自己就会报未定义标识符，重复检查只会产生误报
    files: ["**/*.ts", "**/*.tsx"],
    rules: { "no-undef": "off" },
  },
  {
    files: ["scripts/**/*.{js,mjs,cjs}", "**/*.config.{js,mjs,ts}", "apps/api/scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        ...NODE_GLOBALS,
        // QA 脚本里有 page.evaluate(() => document...) 这类「在浏览器里执行」的回调，
        // 字面上写在 Node 文件里，静态检查需要同时认识浏览器全局。
        document: "readonly",
        window: "readonly",
        performance: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        indexedDB: "readonly",
        getComputedStyle: "readonly",
      },
    },
    rules: {
      "no-console": "off",
      // 这些脚本就是 Node/CJS 入口，require 是正当用法
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/tests/**", "**/__tests__/**"],
    rules: { "no-console": "off" },
  },
);
