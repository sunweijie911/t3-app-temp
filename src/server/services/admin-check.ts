import 'server-only';
import { env } from '@/env';

let parsedEmails: string[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

function getAdminEmails(): string[] {
  const now = Date.now();
  if (parsedEmails && now - cacheTimestamp < CACHE_TTL_MS) {
    return parsedEmails;
  }
  parsedEmails = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  cacheTimestamp = now;
  return parsedEmails;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().includes(email.trim().toLowerCase());
}
