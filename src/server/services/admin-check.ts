import 'server-only';
import { env } from '@/env';

let parsedEmails: string[] | null = null;

function getAdminEmails(): string[] {
  if (parsedEmails) return parsedEmails;
  parsedEmails = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return parsedEmails;
}

export function isAdminEmail(email: string): boolean {
  return getAdminEmails().includes(email.toLowerCase());
}
