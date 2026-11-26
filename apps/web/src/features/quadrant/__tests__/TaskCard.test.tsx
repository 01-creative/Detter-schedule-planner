import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskSchema } from "@detter/shared";
import { TaskCard } from "@/components/common/TaskCard";

/**
 * 任务卡是三态（完成 / 拖拽 / 选中）+ 两个入口（点击、右键）。
 * 这些都用 props 驱动，不需要 Provider，所以可以直接渲染。
 */
function makeTask(overrides: Record<string, unknown> = {}) {
  return TaskSchema.parse({
    id: "task-1",
    title: "交高数作业",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}

describe("TaskCard", () => {
  it("完成态：aria-pressed、划线，双击触发完成回调", async () => {
    const onToggleDone = vi.fn();
    const task = makeTask({ status: "done", completedAt: 1 });
    render(<TaskCard task={task} onToggleDone={onToggleDone} />);

    const card = screen.getByRole("button", { name: "交高数作业，已完成" });
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("交高数作业")).toHaveClass("line-through");

    await userEvent.dblClick(card);
    expect(onToggleDone).toHaveBeenCalledTimes(1);
  });

  it("单击打开、右键与「⋯」都走同一个上下文菜单回调", async () => {
    const onOpen = vi.fn();
    const onContextMenu = vi.fn();
    const task = makeTask();
    render(<TaskCard task={task} onOpen={onOpen} onContextMenu={onContextMenu} />);

    const card = screen.getByRole("button", { name: "交高数作业" });
    await userEvent.click(card);
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.contextMenu(card);
    expect(onContextMenu).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "「交高数作业」更多操作" }));
    expect(onContextMenu).toHaveBeenCalledTimes(2);
  });

  it("逾期的截止时间显示成红色 chip", () => {
    const task = makeTask({
      title: "回复导师邮件",
      dueAt: Date.now() - 60_000,
    });
    render(<TaskCard task={task} />);
    const chip = screen.getByText(/逾期/);
    expect(chip).toBeInTheDocument();
    expect(chip.parentElement).toHaveClass("text-danger-ink");
  });

  it("拖拽态会加 cursor-grabbing 与抬升，且不影响回调", () => {
    const task = makeTask();
    render(<TaskCard task={task} dragging />);
    const card = screen.getByRole("button", { name: "交高数作业" });
    expect(card.className).toContain("cursor-grabbing");
    expect(card.className).toContain("shadow-3");
  });
});
