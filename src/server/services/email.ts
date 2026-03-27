import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';
import { env } from '@/env';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  const user = env.SMTP_USER;
  const pass = env.SMTP_PASS;

  if (!user || !pass) {
    throw new Error('[EMAIL] 生产环境必须配置 SMTP 变量: SMTP_USER, SMTP_PASS');
  }

  const host = env.SMTP_HOST;
  const port = env.SMTP_PORT;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return transporter;
}

/**
 * 发送邮箱验证码。
 *
 * 开发环境：打印到控制台。
 * 生产环境：通过 QQ 邮箱 SMTP 发送。需配置环境变量：
 *   SMTP_USER（QQ 邮箱地址）、SMTP_PASS（SMTP 授权码）
 */
export async function sendEmailOtp(email: string, code: string): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[EMAIL OTP] 邮箱: ${email} | 验证码: ${code}`);
    return;
  }

  await getTransporter().sendMail({
    from: `"验证码" <${env.SMTP_USER}>`,
    to: email,
    subject: '您的登录验证码',
    html: `
      <div style="max-width:400px;margin:0 auto;padding:32px;font-family:sans-serif;">
        <h2 style="color:#333;margin-bottom:16px;">登录验证码</h2>
        <p style="color:#666;margin-bottom:24px;">您的验证码为：</p>
        <div style="background:#f5f5f5;border-radius:8px;padding:16px;text-align:center;font-size:32px;letter-spacing:8px;font-weight:bold;color:#333;">
          ${code}
        </div>
        <p style="color:#999;margin-top:24px;font-size:13px;">验证码 5 分钟内有效，请勿泄露给他人。</p>
      </div>
    `,
  });
}
