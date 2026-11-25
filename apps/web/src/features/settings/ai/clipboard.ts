/**
 * 复制到剪贴板。
 *
 * 优先用 Clipboard API；localhost/HTTPS 之外（比如通过局域网 IP 访问）浏览器会拒绝，
 * 这时退回到隐藏 textarea + execCommand，保证设置页在自托管场景也能用。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下面的兜底
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}
