/**
 * 从请求中提取客户端真实 IP。
 * 优先使用 X-Real-IP（nginx 从 $remote_addr 设置，不可伪造），
 * 再降级到 X-Forwarded-For 的第一段。
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}
