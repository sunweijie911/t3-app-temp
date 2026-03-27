// 将 hex 颜色转为 rgba
export function hexToRgba(hex: string, alpha: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return `rgba(0,82,208,${alpha})`;
  const [, r, g, b] = result;
  return `rgba(${parseInt(r ?? '0', 16)},${parseInt(g ?? '0', 16)},${parseInt(b ?? '0', 16)},${alpha})`;
}

// 获取卡片主题色：白色/空值时回退为品牌蓝
export function getAccentColor(cardBgColor: string | null): string {
  if (
    !cardBgColor ||
    cardBgColor.toLowerCase() === '#ffffff' ||
    cardBgColor.toLowerCase() === '#fff'
  ) {
    return '#0052d0';
  }
  return cardBgColor;
}
