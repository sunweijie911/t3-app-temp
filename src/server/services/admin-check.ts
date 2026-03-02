import 'server-only';
import { env } from '@/env';

let parsedPhones: string[] | null = null;

function getAdminPhones(): string[] {
  if (parsedPhones) return parsedPhones;
  parsedPhones = (env.ADMIN_PHONES ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return parsedPhones;
}

export function isAdminPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  return getAdminPhones().includes(phone.trim());
}
