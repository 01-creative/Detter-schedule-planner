import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, WifiOff } from "lucide-react";
import { Button, Input } from "@detter/ui";
import { useAuth } from "@/app/auth";
import { AuthLayout } from "@/components/common/AuthLayout";
import { FullPageLoading } from "@/components/common/LoadingState";
import { ApiError, api, isOfflineError } from "@/lib/api";
import { getDeviceName, setDeviceName } from "@/lib/device";

/**
 * 登录页。
 *
 * 关键取舍：服务器连不上时提供「离线继续」。
 * 本地优先的产品，登录只是为了同步；网络不通不该让人连自己的任务都看不到。
 */
export default function LoginPage() {
  const { phase, offline, initialized, authenticated, markAuthenticated, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo =
    (location.state as { returnTo?: string } | null)?.returnTo ?? "/";

  const [password, setPassword] = useState("");
  const [device, setDevice] = useState(getDeviceName());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (phase === "checking") return <FullPageLoading message="正在检查登录状态…" />;
  if (!offline && initialized === false) return <Navigate to="/setup" replace />;
  if (!offline && authenticated) return <Navigate to={returnTo} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) return;
    setPending(true);
    setError(null);
    try {
      setDeviceName(device.trim() || getDeviceName());
      await api.post("/auth/login", { password, deviceName: device.trim() });
      markAuthenticated();
      navigate(returnTo, { replace: true });
    } catch (cause) {
      if (isOfflineError(cause)) {
        setError("连不上服务器。可以先用「离线继续」，本地数据照常可用。");
      } else if (cause instanceof ApiError) {
        setError(cause.code === "unauthorized" ? "密码不对，再试一次。" : cause.message);
      } else {
        setError("登录失败，请重试。");
      }
    } finally {
      setPending(false);
    }
  };

  if (offline) {
    return (
      <AuthLayout
        title="服务器暂时连不上"
        description="这台设备上的数据是完整的，可以离线继续使用；联网后再同步。"
      >
        <div className="space-y-3">
          <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-caption text-warning-ink">
            <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            离线模式下无法验证登录状态，但本地读写、快速捕获都不受影响。
          </p>
          <Button className="w-full" onClick={() => navigate("/", { replace: true })}>
            离线继续
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              void refresh();
            }}
          >
            重新连接服务器
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="欢迎回来"
      description="输入主密码以解锁同步。"
      footer={
        <Link
          to="/setup"
          className="text-caption text-ink-500 underline-offset-4 hover:text-ink-900 hover:underline"
        >
          首次部署？去初始化
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-caption text-ink-700">
            主密码
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            invalid={Boolean(error)}
            aria-describedby={error ? "login-error" : undefined}
            placeholder="输入主密码"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="device-name" className="block text-caption text-ink-700">
            设备名
          </label>
          <Input
            id="device-name"
            value={device}
            onChange={(event) => setDevice(event.target.value)}
            maxLength={80}
            placeholder="例如：Mac · Detter"
          />
        </div>

        {error && (
          <p id="login-error" role="alert" className="text-caption text-danger-ink">
            {error}
          </p>
        )}

        <Button
          type="submit"
          className="w-full"
          loading={pending}
          rightIcon={<ArrowRight className="size-4" aria-hidden="true" />}
        >
          登录
        </Button>
      </form>
    </AuthLayout>
  );
}
