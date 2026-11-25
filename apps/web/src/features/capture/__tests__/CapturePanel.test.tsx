import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@detter/ui";
import { db } from "@/db";
import { CapturePanel } from "@/features/capture/CapturePanel";
import { useCaptureStore } from "@/stores/capture";

/**
 * 捕获面板：验收里的第三条硬要求。
 * 「Ctrl+K 能呼出、回车写入收件箱、显示解析预览」必须是一个自动化用例，
 * 否则每次改解析器都得手动点一遍。
 */

beforeEach(async () => {
  await db.delete();
  await db.open();
  useCaptureStore.setState({ open: false, seed: "" });
});

function renderPanel() {
  return render(
    <ToastProvider>
      <CapturePanel />
    </ToastProvider>,
  );
}

describe("CapturePanel", () => {
  it("Ctrl/Cmd+K 呼出，输入时显示解析预览，回车写入收件箱", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.keyboard("{Control>}k{/Control}");

    const input = await screen.findByLabelText("记录内容");
    expect(input).toBeInTheDocument();

    await user.type(input, "明天下午3点 交高数作业 #作业");

    // 预览：标题 + 时间 + 标签 + 象限建议
    await waitFor(() => {
      expect(screen.getByText("交高数作业")).toBeInTheDocument();
    });
    expect(screen.getByText("明天 15:00")).toBeInTheDocument();
    expect(screen.getByText("#作业")).toBeInTheDocument();
    expect(screen.getByText("建议 Q2")).toBeInTheDocument();

    await user.keyboard("{Enter}");

    await waitFor(async () => {
      expect(await db.inbox.count()).toBe(1);
    });

    const [item] = await db.inbox.toArray();
    expect(item).toBeDefined();
    expect(item?.rawText).toBe("明天下午3点 交高数作业 #作业");
    expect(item?.status).toBe("pending");
    expect(item?.source).toBe("hotkey");
    expect(item?.parsed?.title).toBe("交高数作业");
    expect(item?.parsed?.tags).toEqual(["作业"]);

    const startAt = item?.parsed?.startAt ?? 0;
    expect(new Date(startAt).getHours()).toBe(15);
    // 「明天」= 今天 + 1 天（用本地日历比较，避免受执行时刻影响）
    const expected = new Date();
    expected.setDate(expected.getDate() + 1);
    expect(new Date(startAt).getDate()).toBe(expected.getDate());

    // 成功提示 + 面板不关闭（支持连续捕获）
    expect(await screen.findByText(/已收进盒子/)).toBeInTheDocument();
    expect(screen.getByLabelText("记录内容")).toBeInTheDocument();
  });

  it("Esc 关闭面板；空输入回车不会写入", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.keyboard("{Control>}k{/Control}");
    const input = await screen.findByLabelText("记录内容");
    await user.keyboard("{Enter}");
    expect(await db.inbox.count()).toBe(0);

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByLabelText("记录内容")).not.toBeInTheDocument();
    });
    expect(input).toBeTruthy();
  });
});
