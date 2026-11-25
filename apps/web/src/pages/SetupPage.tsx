import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { Button, Input } from "@detter/ui";
import { useAuth } from "@/app/auth";
import { AuthLayout } from "@/components/common/AuthLayout";
import { FullPageLoading } from "@/components/common/LoadingState";
import { ApiError, api, isOfflineError } from "@/lib/api";
import { getDeviceName, setDeviceName } from "@/lib/device";

/**
 * 首次初始化。
 *
 * 服务端只在第一次部署时打印一个一次性口令（setupToken），
 * 用它 + 主密码完成初始化。这里提前做长度与一致性校验，
 * 避免把一个必然失败的表单发给服务端。
 */
export default function SetupPage() {
  const { phase, offline, initialized, markAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [device, setDevice] = useState(getDeviceName());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (phase === "checking") return <FullPageLoading message="正在检查部署状态…" />;
  if (!offline && initialized) return <Navigate to="/login" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 10) {
      setError("主密码至少 10 位。");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致。");
      return;
    }
    setPending(true);
    setError(null);
    try {
      setDeviceName(device.trim() || getDeviceName());
      await api.post("/auth/setup", {
        setupToken: token.trim(),
        password,
        deviceName: device.trim(),
      });
      markAuthenticated();
      navigate("/", { replace: true });
    } catch (cause) {
      if (isOfflineError(cause)) {
        setError("连不上服务器，请确认后端已启动（默认 8787 端口）。");
      } else if (cause instanceof ApiError) {
        setError(
          cause.code === "already_initialized"
            ? "这台服务器已经初始化过了，请直接登录。"
            : cause.code === "forbidden"
              ? "初始化口令不对，请查看服务端启动日志。"
              : cause.message,
        );
      } else {
        setError("初始化失败，请重试。");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout
      title="初始化 Detter"
      description="只需要做一次：设置主密码，之后所有设备用它登录。"
      footer={
        <Link
          to="/login"
          className="text-caption text-ink-500 underline-offset-4 hover:text-ink-900 hover:underline"
        >
          已经初始化过？去登录
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="setup-token" className="block text-caption text-ink-700">
            初始化口令
          </label>
          <Input
            id="setup-token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
            required
            placeholder="服务端启动时打印的一次性口令"
            invalid={Boolean(error)}
          />
          <p className="flex items-center gap-1 text-micro text-ink-300">
            <KeyRound className="size-3" aria-hidden="true" />
            在服务端日志里搜 setup token / DETTER_SETUP_TOKEN
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="new-password" className="block text-caption text-ink-700">
            主密码（至少 10 位）
          </label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            invalid={Boolean(error)}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirm-password" className="block text-caption text-ink-700">
            再输一次
          </label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            invalid={Boolean(error) && password !== confirm}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="device" className="block text-caption text-ink-700">
            设备名
          </label>
          <Input
            id="device"
            value={device}
            onChange={(event) => setDevice(event.target.value)}
            maxLength={80}
          />
        </div>

        {error && (
          <p role="alert" className="text-caption text-danger-ink">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" loading={pending}>
          初始化并进入
        </Button>
      </form>
    </AuthLayout>
  );
}
