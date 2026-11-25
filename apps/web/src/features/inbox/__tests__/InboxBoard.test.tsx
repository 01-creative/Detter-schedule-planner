import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@detter/ui";
import { parseQuickCapture, type ParsedDraft } from "@detter/shared";
import { db } from "@/db";
import { captureInbox, saveEntity } from "@/db/repo";
import { InboxBoard } from "@/features/inbox/InboxBoard";

/**
 * 收件箱分诊（任务书 §8 第 2、3、7 条）。
 *
 * 覆盖的是「一条文本怎么变成一条任务」这条主链路，以及批量整理的门槛确认。
 * 数据是真的写进 fake-indexeddb 的，所以 triaged / taskId 这类状态迁移不是靠 mock 声称的。
 */

beforeEach(async () => {
  await db.delete();
  await db.open();
});

function renderBoard() {
  return render(
    <ToastProvider>
      <InboxBoard />
    </ToastProvider>,
  );
}

async function seed(raw: string, parsed?: ParsedDraft) {
  return captureInbox({ rawText: raw, parsed: parsed ?? parseQuickCapture(raw), source: "hotkey" });
}

describe("收件箱 · 单条分诊", () => {
  it("一键整理：按解析结果建任务，记录变 triaged 并记住 taskId", async () => {
    const user = userEvent.setup();
    await seed("明天下午3点 交高数作业 #作业");
    renderBoard();

    const button = await screen.findByRole("button", { name: "一键整理" });
    await user.click(button);

    await waitFor(async () => {
      expect(await db.tasks.count()).toBe(1);
    });

    const [task] = await db.tasks.toArray();
    expect(task?.title).toBe("交高数作业");
    expect(task?.quadrant).toBe(2);
    expect(task?.status).toBe("todo");
    expect(task?.tags).toEqual(["作业"]);

    const [item] = await db.inbox.toArray();
    expect(item?.status).toBe("triaged");
    expect(item?.taskId).toBe(task?.id);

    // 待整理空了，记录进了「已整理」区
    expect(await screen.findByText(/已整理 1 条/)).toBeInTheDocument();
    expect(screen.getByText("待整理已清空")).toBeInTheDocument();
  });

  it("转任务：编辑器预填解析结果，保存后落库", async () => {
    const user = userEvent.setup();
    await seed("明天下午3点 交高数作业 #作业");
    renderBoard();

    await user.click(await screen.findByRole("button", { name: "转任务" }));

    const dialog = await screen.findByRole("dialog");
    const title = within(dialog).getByLabelText("任务标题") as HTMLInputElement;
    expect(title.value).toBe("交高数作业");

    // 用 change 而不是逐字 type：全集并行跑时逐字输入会跟 liveQuery 重渲染抢时序
    fireEvent.change(title, { target: { value: "交高数作业（第 12 周）" } });
    await user.click(within(dialog).getByRole("button", { name: "保存任务" }));

    await waitFor(async () => expect(await db.tasks.count()).toBe(1));
    const [task] = await db.tasks.toArray();
    expect(task?.title).toBe("交高数作业（第 12 周）");
    expect(task?.manualQuadrant).toBe(true);

    const [item] = await db.inbox.toArray();
    expect(item?.status).toBe("triaged");
  });

  it("归档后可以恢复，且不会建任务", async () => {
    const user = userEvent.setup();
    await seed("一个暂时不想处理的想法");
    renderBoard();

    await user.click(await screen.findByRole("button", { name: "更多操作" }));
    await user.click(await screen.findByRole("button", { name: "归档" }));

    await waitFor(async () => {
      const [item] = await db.inbox.toArray();
      expect(item?.status).toBe("archived");
    });
    expect(await db.tasks.count()).toBe(0);

    // 撤销条：恢复成待整理
    await user.click(await screen.findByRole("button", { name: "撤销" }));
    await waitFor(async () => {
      const [item] = await db.inbox.toArray();
      expect(item?.status).toBe("pending");
    });
  });

  it("删除是软删除，撤销后原文和解析都还在", async () => {
    const user = userEvent.setup();
    await seed("删除我也没关系 #临时");
    renderBoard();

    await user.click(await screen.findByRole("button", { name: "更多操作" }));
    await user.click(await screen.findByRole("button", { name: "删除" }));

    await waitFor(async () => {
      const [item] = await db.inbox.toArray();
      expect(item?.deletedAt).not.toBeNull();
    });

    await user.click(await screen.findByRole("button", { name: "撤销" }));
    await waitFor(async () => {
      const [item] = await db.inbox.toArray();
      expect(item?.deletedAt).toBeNull();
      expect(item?.rawText).toBe("删除我也没关系 #临时");
      expect(item?.parsed?.tags).toEqual(["临时"]);
    });
  });

  it("内联编辑原文后会重新解析 chips", async () => {
    const user = userEvent.setup();
    await seed("旧的一句话");
    renderBoard();

    await user.click(await screen.findByRole("button", { name: "更多操作" }));
    await user.click(await screen.findByRole("button", { name: "编辑原文" }));

    const editor = await screen.findByLabelText("编辑原文");
    fireEvent.change(editor, { target: { value: "明天 复习线代 #学习" } });
    await user.click(screen.getByRole("button", { name: "保存原文" }));

    await waitFor(async () => {
      const [item] = await db.inbox.toArray();
      expect(item?.rawText).toBe("明天 复习线代 #学习");
      expect(item?.parsed?.tags).toEqual(["学习"]);
    });
  });
});

describe("收件箱 · 批量", () => {
  it("批量选择后「全部归档」", async () => {
    const user = userEvent.setup();
    await seed("第一条");
    await seed("第二条");
    renderBoard();

    await user.click(await screen.findByRole("button", { name: "批量选择" }));
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    for (const box of boxes) await user.click(box);

    await user.click(screen.getByRole("button", { name: "全部归档" }));

    await waitFor(async () => {
      const rows = await db.inbox.toArray();
      expect(rows.every((row) => row.status === "archived")).toBe(true);
    });
    expect(await db.tasks.count()).toBe(0);
  });

  it("超过 10 条时「全部整理」先确认，确认后逐条建任务", async () => {
    const user = userEvent.setup();
    for (let index = 1; index <= 12; index += 1) {
      await seed(`第 ${index} 条待办`);
    }
    renderBoard();

    await user.click(await screen.findByRole("button", { name: "全部整理" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/整理这 12 条记录/)).toBeInTheDocument();

    // 确认之前一条都不该建
    expect(await db.tasks.count()).toBe(0);

    await user.click(within(dialog).getByRole("button", { name: "全部整理" }));

    await waitFor(
      async () => {
        expect(await db.tasks.count()).toBe(12);
      },
      { timeout: 8000 },
    );

    const rows = await db.inbox.toArray();
    expect(rows.every((row) => row.status === "triaged")).toBe(true);
  });

  it("10 条以内不弹确认，直接整理", async () => {
    const user = userEvent.setup();
    for (let index = 1; index <= 3; index += 1) await seed(`第 ${index} 条`);

    renderBoard();
    await user.click(await screen.findByRole("button", { name: "全部整理" }));

    await waitFor(async () => expect(await db.tasks.count()).toBe(3));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("收件箱 · 智能提示", () => {
  it("与 7 天内任务高度相似时提示「可能重复」", async () => {
    await saveEntity("task", { title: "交高数作业", status: "todo", quadrant: 2 });
    await seed("交高数作业");

    renderBoard();
    expect(await screen.findByText("可能重复")).toBeInTheDocument();
    // 鼠标悬停能看到是哪一条
    expect(screen.getByTitle("与「交高数作业」很像")).toBeInTheDocument();
  });

  it("时间重叠时提示与哪条任务冲突", async () => {
    const base = Date.now() + 3 * 3_600_000;
    await saveEntity("task", {
      title: "写周报",
      startAt: base,
      endAt: base + 3_600_000,
      status: "todo",
      quadrant: 2,
    });

    const draft = parseQuickCapture("写周报");
    await seed("写周报", { ...draft, startAt: base + 1_800_000, endAt: null });

    renderBoard();
    expect(await screen.findByText("与「写周报」冲突")).toBeInTheDocument();
  });
});
