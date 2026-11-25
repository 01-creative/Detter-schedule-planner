import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@detter/ui";
import { db } from "@/db";
import { CapturePanel } from "@/features/capture/CapturePanel";
import { DRAFT_STORAGE_KEY } from "@/features/capture/draft-store";
import { useCaptureStore } from "@/stores/capture";

/**
 * 捕获面板的验收用例（任务书 §8 第 1、4、6、7 条）。
 *
 * 这些用例直接在 jsdom + fake-indexeddb 上跑真实链路：
 * 按键 → 解析 → repo → Dexie，没有任何 mock，所以「写进本地库」这件事是真的被验证了。
 */

beforeEach(async () => {
  await db.delete();
  await db.open();
  useCaptureStore.setState({ open: false, seed: "" });
});

function renderPanel(route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ToastProvider>
        <CapturePanel />
      </ToastProvider>
    </MemoryRouter>,
  );
}

async function openPanel(user: ReturnType<typeof userEvent.setup>, route = "/") {
  renderPanel(route);
  await user.keyboard("{Control>}k{/Control}");
  return screen.findByLabelText("记录内容");
}

describe("捕获面板 · 记录", () => {
  it("输入一句话回车：落库、清空输入、面板不关、顶部提示", async () => {
    const user = userEvent.setup();
    const input = await openPanel(user);

    await user.type(input, "明天下午3点 交高数作业 #作业");

    // 解析预览：时间 / 标签 / 象限建议
    await waitFor(() => {
      expect(screen.getByText("明天 15:00")).toBeInTheDocument();
    });
    expect(screen.getByText("#作业")).toBeInTheDocument();
    expect(screen.getByText("建议 Q2")).toBeInTheDocument();

    await user.keyboard("{Enter}");

    await waitFor(async () => {
      expect(await db.inbox.count()).toBe(1);
    });

    const [item] = await db.inbox.toArray();
    expect(item?.rawText).toBe("明天下午3点 交高数作业 #作业");
    expect(item?.status).toBe("pending");
    expect(item?.source).toBe("hotkey");
    expect(item?.parsed?.title).toBe("交高数作业");
    expect(item?.parsed?.tags).toEqual(["作业"]);

    const startAt = item?.parsed?.startAt ?? 0;
    expect(new Date(startAt).getHours()).toBe(15);
    const expected = new Date();
    expected.setDate(expected.getDate() + 1);
    expect(new Date(startAt).getDate()).toBe(expected.getDate());

    // 连续捕获：面板还在，输入框已清空，成功提示是浮层
    expect(await screen.findByText(/已收进盒子/)).toBeInTheDocument();
    expect(screen.getByLabelText("记录内容")).toHaveValue("");

    // 断网也成功的关键：这条写入已经进了 outbox，等联网后推送
    expect(await db.outbox.count()).toBe(1);
    expect((await db.outbox.toArray())[0]?.entity).toBe("inbox");
  });

  it("连续记录两条：不关面板、计数累加、两条都在库里", async () => {
    const user = userEvent.setup();
    const input = await openPanel(user);

    await user.type(input, "第一条 买牛奶");
    await user.keyboard("{Enter}");
    await waitFor(async () => expect(await db.inbox.count()).toBe(1));

    await user.type(input, "第二条 交电费 明天");
    await user.keyboard("{Enter}");
    await waitFor(async () => expect(await db.inbox.count()).toBe(2));

    expect(screen.getByLabelText("记录内容")).toBeInTheDocument();
    expect(await screen.findByText("已记录 2 条")).toBeInTheDocument();

    const texts = (await db.inbox.toArray()).map((row) => row.rawText).sort();
    expect(texts).toEqual(["第一条 买牛奶", "第二条 交电费 明天"].sort());
  });

  it("多行粘贴：先预览 3 条，确认后批量落库", async () => {
    const user = userEvent.setup();
    const input = await openPanel(user);

    fireEvent.paste(input, {
      clipboardData: {
        getData: () => "买牛奶\n明天 交电费\n周五 复习线代 #学习",
      },
    });

    expect(await screen.findByText(/粘贴了/)).toBeInTheDocument();
    expect(screen.getByText("买牛奶")).toBeInTheDocument();
    expect(screen.getByText("明天 交电费")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "全部保存" }));

    await waitFor(async () => {
      expect(await db.inbox.count()).toBe(3);
    });

    const rows = await db.inbox.toArray();
    expect(rows.map((row) => row.rawText).sort()).toEqual(
      ["买牛奶", "明天 交电费", "周五 复习线代 #学习"].sort(),
    );
    expect(rows.every((row) => row.status === "pending")).toBe(true);
    expect(rows.every((row) => row.parsed !== null)).toBe(true);
  });

  it("Ctrl+Shift+Enter：保存为 Q1，同时建任务并把记录标成已分诊", async () => {
    const user = userEvent.setup();
    const input = await openPanel(user);

    await user.type(input, "马上交高数作业");
    await user.keyboard("{Control>}{Shift>}{Enter}{/Shift}{/Control}");

    await waitFor(async () => {
      expect(await db.tasks.count()).toBe(1);
    });

    const [task] = await db.tasks.toArray();
    expect(task?.quadrant).toBe(1);
    expect(task?.status).toBe("todo");
    expect(task?.source).toBe("capture");

    const [item] = await db.inbox.toArray();
    expect(item?.status).toBe("triaged");
    expect(item?.taskId).toBe(task?.id);
  });

  it("草稿恢复：重开面板时带回上次没写完的那句话", async () => {
    localStorage.setItem(DRAFT_STORAGE_KEY, "重新打开时我应该还在");
    const user = userEvent.setup();
    const input = await openPanel(user);
    expect(input).toHaveValue("重新打开时我应该还在");

    // 保存成功后草稿要被清掉，不能下次又把旧内容带回来
    await user.click(input);
    await user.keyboard("{Enter}");
    await waitFor(async () => expect(await db.inbox.count()).toBe(1));
    expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("未登录（/login）：Ctrl+K 不弹面板，只给一句提示", async () => {
    const user = userEvent.setup();
    renderPanel("/login");

    await user.keyboard("{Control>}k{/Control}");

    expect(screen.queryByLabelText("记录内容")).not.toBeInTheDocument();
    expect(await screen.findByText("登录之后才能记")).toBeInTheDocument();
    expect(await db.inbox.count()).toBe(0);
  });

  it("↑/↓ 在候选间移动、Tab 接受：不用鼠标也能改象限", async () => {
    const user = userEvent.setup();
    const input = await openPanel(user);

    await user.type(input, "写周报");
    await waitFor(() => expect(screen.getByText("建议 Q2")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "微调象限" }));
    expect(screen.getByText(/↑↓ 切换/)).toBeInTheDocument();

    await user.click(input);
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getByText("建议 Q3")).toBeInTheDocument());

    await user.keyboard("{Tab}");
    await waitFor(() => expect(screen.queryByText(/↑↓ 切换/)).not.toBeInTheDocument());

    await user.keyboard("{Enter}");
    await waitFor(async () => expect(await db.inbox.count()).toBe(1));
    const [item] = await db.inbox.toArray();
    expect(item?.parsed?.quadrantGuess).toBe(3);
  });

  it("Esc：空输入一次关闭，有内容时要点两次", async () => {
    const user = userEvent.setup();
    const input = await openPanel(user);

    await user.type(input, "还没写完的一句");
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("记录内容")).toBeInTheDocument();
    expect(await screen.findByText(/再按一次 Esc/)).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByLabelText("记录内容")).not.toBeInTheDocument();
    });
    // 关闭不能丢内容：草稿留在 localStorage 里
    expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBe("还没写完的一句");
  });
});

describe("捕获面板 · 移动端", () => {
  it("窄屏下是底部 sheet：快捷 chip 插入文本，点「完成」保存", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("767"),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    try {
      const user = userEvent.setup();
      const input = await openPanel(user);

      await user.click(screen.getByRole("button", { name: "明天" }));
      expect(input).toHaveValue("明天 ");

      await user.click(screen.getByRole("button", { name: "完成" }));

      await waitFor(async () => {
        expect(await db.inbox.count()).toBe(1);
      });
      const [item] = await db.inbox.toArray();
      expect(item?.source).toBe("mobile");
      expect(item?.rawText).toBe("明天");
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("捕获面板 · 无目标时也能解析", () => {
  it("@ 引用不在目标列表里时，解析结果仍保留原始引用文本", async () => {
    const user = userEvent.setup();
    const input = await openPanel(user);

    await user.type(input, "写开题报告 @毕设");
    await waitFor(() => {
      expect(screen.getByText("@毕设")).toBeInTheDocument();
    });

    await user.keyboard("{Enter}");
    await waitFor(async () => expect(await db.inbox.count()).toBe(1));
    const [item] = await db.inbox.toArray();
    expect(item?.rawText).toBe("写开题报告 @毕设");
    expect(item?.parsed?.goalTitle).toBe("毕设");
  });
});
