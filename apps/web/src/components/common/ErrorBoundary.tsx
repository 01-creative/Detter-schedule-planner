import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { ErrorState } from "./ErrorState";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 兜底错误边界。
 *
 * 任何未捕获的渲染异常都不应该变成白屏 —— 任务书 §4.7 的底线是
 * 「不要出现白屏 + 控制台报错」。这里把异常收成一张可重试的错误卡。
 */
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 单人应用不做错误上报；留一条结构化日志方便排查
    console.error("[detter] 渲染异常", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <ErrorState
          title="页面渲染出错了"
          description={this.state.error.message || "未知错误"}
          onRetry={() => {
            this.setState({ error: null });
            window.location.reload();
          }}
          retryLabel="重新加载"
        />
      );
    }
    return this.props.children;
  }
}
