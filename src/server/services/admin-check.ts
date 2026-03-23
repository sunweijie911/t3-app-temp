import 'server-only';
import { env } from '@/env';

let adminEmails: string[] = [];
let adminPhones: string[] = [];
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

function refreshCache() {
  const now = Date.now();
  if (cacheTimestamp > 0 && now - cacheTimestamp < CACHE_TTL_MS) return;
  adminEmails = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  adminPhones = (env.ADMIN_PHONES ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  cacheTimestamp = now;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  refreshCache();
  return adminEmails.includes(email.trim().toLowerCase());
}

export function isAdminPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  refreshCache();
  return adminPhones.includes(phone.trim());
}
