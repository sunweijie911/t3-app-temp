import 'server-only';
import { env } from '@/env';

let parsedPhones: string[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

function getAdminPhones(): string[] {
  const now = Date.now();
  if (parsedPhones && now - cacheTimestamp < CACHE_TTL_MS) {
    return parsedPhones;
  }
  parsedPhones = (env.ADMIN_PHONES ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  cacheTimestamp = now;
  return parsedPhones;
}

export function isAdminPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  return getAdminPhones().includes(phone.trim());
}
