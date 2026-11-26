import { useCallback, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { saveEntity } from "@/db/repo";
import { DEFAULT_FOCUS_SETTINGS, FOCUS_SETTINGS_KEY, sanitizeSettings } from "./pomodoroModel";
import type { FocusSettings } from "./pomodoroModel";

/**
 * 番茄钟设置：读写 settings 表中 `focus.pomodoro` 一行。
 *
 * 为什么不用 localStorage：任务书要求设置跟着账号跨设备同步，而 settings 表
 * 的写入会进 outbox，换设备登录后同样是 25/5/15/4。
 * id 固定为 `setting:focus.pomodoro`，保证同一个 key 永远只有一行。
 *
 * 返回值用 useMemo 稳定引用：设置对象每次渲染都新建的话，
 * 依赖它的计时器效果会反复重跑。
 */
export function useFocusSettings(): [FocusSettings, (value: FocusSettings) => void] {
  const stored = useLiveQuery(async () => {
    const rows = await db.settings.where("key").equals(FOCUS_SETTINGS_KEY).toArray();
    const alive = rows
      .filter((row) => !row.deletedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return alive[0]?.value;
  }, []);

  const settings = useMemo(
    () => (stored === undefined ? DEFAULT_FOCUS_SETTINGS : sanitizeSettings(stored)),
    [stored],
  );

  const setValue = useCallback((value: FocusSettings) => {
    void saveEntity("setting", {
      id: `setting:${FOCUS_SETTINGS_KEY}`,
      key: FOCUS_SETTINGS_KEY,
      value: sanitizeSettings(value),
    });
  }, []);

  return [settings, setValue];
}
