import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 合并类名。
 *
 * 为什么需要 twMerge：组件把 `className` 暴露给调用方后，冲突类（p-2 与 p-4）
 * 靠字符串拼接无法决定谁生效；tailwind-merge 会按「后者覆盖前者」的业务直觉处理。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
