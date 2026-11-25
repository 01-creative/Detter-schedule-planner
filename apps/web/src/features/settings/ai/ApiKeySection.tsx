import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Check, Copy, KeyRound, Plus, Trash } from "lucide-react";
import type { ApiKeyCreated, ApiKeyInfo, ApiScope } from "@detter/shared";
import { Badge, Button, Card, Dialog, Input, cn, useToast } from "@detter/ui";
import { formatDateLabel, formatRelative } from "@/lib/format";
import {
  buildMcpConfig,
  createApiKey,
  errorMessage,
  listApiKeys,
  revokeApiKey,
} from "./api";
import { copyText } from "./clipboard";

/**
 * API 密钥管理（T12 §3）。
 *
 * 三条 UX 约束：
 * 1. 明文只显示一次：创建成功弹一次性展示框，关闭后列表里只有 prefix；
 * 2. 最后使用时间要显眼：发现异常可以立刻吊销；
 * 3. 吊销是破坏性操作：二次确认，且说明「AI 会立刻失去权限」。
 */

const SCOPE_LABEL: Record<ApiScope, string> = {
  read: "读取",
  write: "写入",
  admin: "管理密钥",
};

const SCOPE_TONE: Record<ApiScope, "info" | "accent" | "warning"> = {
  read: "info",
  write: "accent",
  admin: "warning",
};

const EXPIRY_OPTIONS = [
  { value: "0", label: "永不过期" },
  { value: "30", label: "30 天" },
  { value: "90", label: "90 天" },
  { value: "365", label: "1 年" },
];

export interface ApiKeySectionProps {
  /** 创建成功后把明文交给父组件，用于在 MCP 配置卡片里自动填充 */
  onKeyCreated: (created: ApiKeyCreated) => void;
}

export function ApiKeySection({ onKeyCreated }: ApiKeySectionProps) {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("claude-desktop");
  const [scopes, setScopes] = useState<ApiScope[]>(["read", "write"]);
  const [expiry, setExpiry] = useState("0");
  const [formError, setFormError] = useState<string | null>(null);

  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState<"key" | "config" | null>(null);
  const [creating, setCreating] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<ApiKeyInfo | null>(null);
  const [revoking, setRevoking] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listApiKeys();
      setKeys(items);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreate = () => {
    setName("claude-desktop");
    setScopes(["read", "write"]);
    setExpiry("0");
    setFormError(null);
    setCreateOpen(true);
  };

  const toggleScope = (scope: ApiScope) => {
    setScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setFormError("给密钥起个名字，方便以后认出它（如 claude-desktop）");
      return;
    }
    if (scopes.length === 0) {
      setFormError("至少选择一个 scope");
      return;
    }

    setFormError(null);
    setCreating(true);
    try {
      const result = await createApiKey({
        name: trimmed,
        scopes,
        expiresInDays: expiry === "0" ? undefined : Number(expiry),
      });
      setCreateOpen(false);
      setCreated(result);
      onKeyCreated(result);
      toast({ title: "密钥已创建", description: "明文只显示这一次，请现在保存。", tone: "success" });
      await refresh();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (kind: "key" | "config", text: string) => {
    const ok = await copyText(text);
    if (!ok) {
      toast({ title: "复制失败", description: "请手动选中文本复制。", tone: "danger" });
      return;
    }
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 2000);
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await revokeApiKey(revokeTarget.id);
      toast({ title: "已吊销", description: `${revokeTarget.name} 立刻失效。`, tone: "success" });
      setRevokeTarget(null);
      await refresh();
    } catch (error) {
      toast({ title: "吊销失败", description: errorMessage(error), tone: "danger" });
    } finally {
      setRevoking(false);
    }
  };

  const activeCount = keys?.filter((key) => key.revokedAt === null).length ?? null;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="size-4 text-accent" aria-hidden="true" />
        <h2 className="text-h2 text-ink-900">API 密钥</h2>
        <Badge tone={activeCount && activeCount > 0 ? "success" : "neutral"} dot>
          {activeCount === null ? "加载中" : `${activeCount} 个可用`}
        </Badge>
        <Button
          className="ml-auto"
          size="sm"
          onClick={openCreate}
          leftIcon={<Plus className="size-3.5" aria-hidden="true" />}
        >
          新建密钥
        </Button>
      </div>

      <p className="text-caption text-ink-500">
        建议给 AI 用 <span className="font-mono text-ink-700">read + write</span>，不要给{" "}
        <span className="font-mono text-ink-700">admin</span>（admin 能创建和吊销密钥）。
        明文只显示一次，泄露后立即吊销。
      </p>

      {loadError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md bg-danger-soft px-3 py-2 text-caption text-danger-ink"
        >
          <span className="min-w-0 flex-1">{loadError}</span>
          <Button size="sm" variant="secondary" loading={loading} onClick={() => void refresh()}>
            重试
          </Button>
        </div>
      )}

      {keys === null && !loadError && (
        <p aria-busy="true" className="text-caption text-ink-500">
          正在加载密钥…
        </p>
      )}

      {keys !== null && keys.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-caption text-ink-500">
          还没有密钥。创建一个给 Claude Desktop / Cursor 用。
        </p>
      )}

      {keys !== null && keys.length > 0 && (
        <ul className="space-y-2">
          {keys.map((key) => {
            const revoked = key.revokedAt !== null;
            return (
              <li
                key={key.id}
                className={cn(
                  "flex flex-wrap items-start gap-3 rounded-md border border-border bg-surface-solid px-3 py-2.5",
                  revoked && "opacity-60",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-caption font-strong text-ink-900">{key.name}</span>
                    {key.scopes.map((scope) => (
                      <Badge key={scope} tone={SCOPE_TONE[scope]}>
                        {SCOPE_LABEL[scope]}
                      </Badge>
                    ))}
                    {revoked && <Badge tone="danger">已吊销</Badge>}
                  </div>
                  <p className="mt-1 truncate font-mono text-micro text-ink-500" title={`dtk_${key.prefix}_…`}>
                    dtk_{key.prefix}_••••••••••••••••
                  </p>
                  <p className="mt-1 text-micro text-ink-300">
                    最后使用：{key.lastUsedAt ? formatRelative(key.lastUsedAt) : "从未使用"}
                    {key.expiresAt ? ` · ${formatDateLabel(key.expiresAt)} 过期` : " · 永不过期"}
                  </p>
                </div>
                {!revoked && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setRevokeTarget(key)}
                    leftIcon={<Trash className="size-3.5" aria-hidden="true" />}
                  >
                    吊销
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 新建 */}
      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="新建 API Key"
        description="给外部 AI 一把只属于它的钥匙，可随时吊销。"
        size="md"
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button size="sm" type="submit" form="create-api-key" loading={creating}>
              创建
            </Button>
          </>
        }
      >
        <form id="create-api-key" className="space-y-4" onSubmit={handleCreate}>
          <div className="space-y-1">
            <label htmlFor="api-key-name" className="block text-caption text-ink-700">
              名称
            </label>
            <Input
              id="api-key-name"
              value={name}
              maxLength={80}
              placeholder="claude-desktop-2026"
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
            <p className="text-micro text-ink-300">起一个能认出用途和日期的名字。</p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-caption text-ink-700">权限（scope）</legend>
            <div className="flex flex-wrap gap-2">
              {(["read", "write", "admin"] as const).map((scope) => {
                const selected = scopes.includes(scope);
                return (
                  <button
                    key={scope}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleScope(scope)}
                    className={cn(
                      "flex h-9 items-center gap-2 rounded-md border px-3 text-caption transition-colors",
                      selected
                        ? "border-accent/30 bg-accent-soft text-accent"
                        : "border-border bg-surface-solid text-ink-500 hover:border-border-strong hover:text-ink-900",
                    )}
                  >
                    {SCOPE_LABEL[scope]}
                    <span className="font-mono text-micro opacity-70">{scope}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-micro text-ink-300">read 只能看；write 能建/改/删；admin 还能管密钥和密码。</p>
          </fieldset>

          <div className="space-y-1">
            <label htmlFor="api-key-expiry" className="block text-caption text-ink-700">
              有效期
            </label>
            <select
              id="api-key-expiry"
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface-solid px-3 text-body text-ink-900 focus:border-accent focus:ring-4 focus:ring-accent/15"
            >
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {formError && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-caption text-danger-ink">
              {formError}
            </p>
          )}
        </form>
      </Dialog>

      {/* 一次性明文 */}
      <Dialog
        open={created !== null}
        onOpenChange={(open) => {
          if (!open) setCreated(null);
        }}
        title="密钥已创建"
        description="这是唯一一次显示明文；关掉后只能看到前缀。"
        size="md"
        dismissible={false}
        footer={
          <Button size="sm" onClick={() => setCreated(null)}>
            我已保存
          </Button>
        }
      >
        {created && (
          <div className="space-y-4">
            <div className="rounded-md border border-warning/30 bg-warning-soft/60 p-3">
              <p className="text-micro text-warning-ink">密钥明文（只显示一次）</p>
              <p className="mt-1 break-all font-mono text-caption text-ink-900 select-all">{created.plaintext}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => void handleCopy("key", created.plaintext)}
                leftIcon={
                  copied === "key" ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )
                }
              >
                {copied === "key" ? "已复制" : "复制密钥"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleCopy("config", buildMcpConfig(created.plaintext))}
                leftIcon={
                  copied === "config" ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )
                }
              >
                {copied === "config" ? "已复制配置" : "复制 MCP 配置"}
              </Button>
            </div>

            <div>
              <p className="text-caption text-ink-700">MCP 配置（Claude Desktop / Cursor）</p>
              <pre className="mt-1 max-h-56 overflow-auto rounded-md bg-surface-sunken p-3 font-mono text-micro leading-relaxed text-ink-700">
                {buildMcpConfig(created.plaintext)}
              </pre>
            </div>
          </div>
        )}
      </Dialog>

      {/* 吊销确认 */}
      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        title="吊销这把密钥？"
        description="使用它的 AI 会立刻失去访问权限，且无法恢复。"
        size="sm"
        dismissible={false}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setRevokeTarget(null)}>
              取消
            </Button>
            <Button size="sm" variant="danger" loading={revoking} onClick={() => void handleRevoke()}>
              确认吊销
            </Button>
          </>
        }
      >
        <p className="text-caption text-ink-500">
          {revokeTarget ? `${revokeTarget.name}（dtk_${revokeTarget.prefix}_…）` : ""}
          <br />
          如果只是不想让它继续用，吊销比删掉更安全：审计日志还能指回这把钥匙。
        </p>
      </Dialog>
    </Card>
  );
}
