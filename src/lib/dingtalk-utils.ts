// 检测是否在钉钉环境中
export function isDingTalk() {
  if (typeof window === 'undefined') return false;
  return /DingTalk/i.test(navigator.userAgent);
}

// 检测是否为 scheme 协议链接（如 alipays://、weixin:// 等）
export function isSchemeLink(link: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(link) && !link.startsWith('http');
}

// 在钉钉/scheme/普通浏览器中打开链接
export function openLink(link: string) {
  if (typeof window === 'undefined') return;

  // 钉钉环境：使用 dd.openLink
  if (isDingTalk()) {
    const dd = (window as unknown as Record<string, unknown>).dd as
      | { openLink?: (opts: { url: string }) => void }
      | undefined;
    if (dd?.openLink) {
      dd.openLink({ url: link });
      return;
    }
  }

  // scheme 链接：用 location.href 唤起本地 App
  if (isSchemeLink(link)) {
    window.location.href = link;
    return;
  }

  // HTTPS 链接：新窗口打开
  window.open(link, '_blank', 'noopener,noreferrer');
}
