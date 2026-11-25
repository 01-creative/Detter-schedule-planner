import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@detter/ui";
import { db } from "@/db";
import { ShareTarget } from "@/features/capture/ShareTarget";

/**
 * 分享落地页（`/share`）。
 *
 * 手机系统分享菜单、浏览器书签小工具都把内容塞进 query 里。
 * 这里验证「落地即入库」这条契约 —— 路由由总工接线，组件本身必须自洽。
 */

beforeEach(async () => {
  await db.delete();
  await db.open();
});

function renderShare(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/share${search}`]}>
      <ToastProvider>
        <ShareTarget />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("ShareTarget", () => {
  it("?text= 直接写进收件箱，来源标记为 share", async () => {
    renderShare(`?text=${encodeURIComponent("明天下午3点 交高数作业 #作业")}`);

    await waitFor(
      async () => {
        expect(await db.inbox.count()).toBe(1);
      },
      { timeout: 4000 },
    );

    const [item] = await db.inbox.toArray();
    expect(item?.rawText).toBe("明天下午3点 交高数作业 #作业");
    expect(item?.source).toBe("share");
    expect(item?.status).toBe("pending");
    expect(item?.parsed?.title).toBe("交高数作业");
  });

  it("?title= 与 ?url= 会合并成一条（url 不丢）", async () => {
    renderShare(
      `?title=${encodeURIComponent("一篇文章")}&url=${encodeURIComponent("https://example.com/a")}`,
    );

    await waitFor(
      async () => {
        expect(await db.inbox.count()).toBe(1);
      },
      { timeout: 4000 },
    );

    const [item] = await db.inbox.toArray();
    expect(item?.rawText).toBe("一篇文章 https://example.com/a");
  });

  it("没有参数时给出提示，不写空记录", async () => {
    renderShare("");
    expect(await screen.findByText("没有可收的内容")).toBeInTheDocument();
    expect(await db.inbox.count()).toBe(0);
  });
});
