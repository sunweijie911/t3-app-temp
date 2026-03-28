import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

/** Strip surrounding quotes that Docker --env-file preserves verbatim */
const stripQuotes = (/** @type {string | undefined} */ v) =>
  v?.replace(/^["']|["']$/g, '');

export const env = createEnv({
  server: {
    // 数据库
    DATABASE_URL: z.url(),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),

    // 认证 (Better Auth)
    BETTER_AUTH_SECRET:
      process.env.NODE_ENV === 'production'
        ? z.string()
        : z.string().optional(),
    BETTER_AUTH_URL:
      process.env.NODE_ENV === 'production' ? z.url() : z.url().optional(),

    // 权限
    ADMIN_EMAILS: z.string().optional(),
    ADMIN_PHONES: z.string().optional(),

    // 邮箱 SMTP（email-otp 方式需要，生产环境必填）
    SMTP_HOST: z.string().default('smtp.qq.com'),
    SMTP_PORT: z.coerce.number().int().default(465),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),

    // 阿里云短信（phone-otp 方式需要，生产环境必填）
    SMS_ACCESS_KEY_ID: z.string().optional(),
    SMS_ACCESS_KEY_SECRET: z.string().optional(),
    SMS_SIGN_NAME: z.string().optional(),
    SMS_TEMPLATE_CODE: z.string().optional(),

    // LLM (大语言模型)
    LLM_API_KEY: z.string().optional(),
    LLM_ALLOWED_HOSTS: z.string().optional(),

    // 敏感数据加密（生产环境必填）
    ID_CARD_ENCRYPTION_KEY: z.string().optional(),

    // 钉钉 LINK 网关
    DINGTALK_LINK_GATEWAY: z.url().optional(),

    // 定时任务鉴权密钥（Cron 接口使用 Bearer Token 校验）
    CRON_SECRET: z.string().optional(),

    // 限流配置（格式: "次数/窗口毫秒"，如 "10/60000" 表示每分钟10次）
    RATE_LIMIT_REPORT_GENERATE: z.string().default('3/60000'),
    RATE_LIMIT_QUESTION_GENERATE: z.string().default('5/60000'),
    RATE_LIMIT_DRAW: z.string().default('10/60000'),
    RATE_LIMIT_UPLOAD: z.string().default('5/60000'),
    RATE_LIMIT_DINGTALK_USER_INFO: z.string().default('30/60000'),
    RATE_LIMIT_GLOBAL_IP: z.string().default('60/60000'),
    RATE_LIMIT_AUTH_IP: z.string().default('5/60000'),
  },

  client: {
    // 站点名称（登录页品牌名、后台标题）
    NEXT_PUBLIC_SITE_NAME: z.string().default('跳跳商城'),
    // 模块显示名称覆盖，格式: "moduleId:名称,moduleId:名称"
    NEXT_PUBLIC_MODULE_NAMES: z.string().default(''),
    // 默认展示模块
    NEXT_PUBLIC_DEFAULT_MODULE: z.string().default('lucky-wheel'),
    // 启用的模块列表，逗号分隔，留空展示全部
    NEXT_PUBLIC_ENABLED_MODULES: z.string().default(''),
    // 登录方式（单选）: email-password | phone-otp | email-otp
    NEXT_PUBLIC_AUTH_METHOD: z.string().default('email-otp'),
  },

  runtimeEnv: {
    DATABASE_URL: stripQuotes(process.env.DATABASE_URL),
    NODE_ENV: stripQuotes(process.env.NODE_ENV),
    BETTER_AUTH_SECRET: stripQuotes(process.env.BETTER_AUTH_SECRET),
    BETTER_AUTH_URL: stripQuotes(process.env.BETTER_AUTH_URL),
    ADMIN_EMAILS: stripQuotes(process.env.ADMIN_EMAILS),
    ADMIN_PHONES: stripQuotes(process.env.ADMIN_PHONES),
    SMTP_HOST: stripQuotes(process.env.SMTP_HOST),
    SMTP_PORT: stripQuotes(process.env.SMTP_PORT),
    SMTP_USER: stripQuotes(process.env.SMTP_USER),
    SMTP_PASS: stripQuotes(process.env.SMTP_PASS),
    SMS_ACCESS_KEY_ID: stripQuotes(process.env.SMS_ACCESS_KEY_ID),
    SMS_ACCESS_KEY_SECRET: stripQuotes(process.env.SMS_ACCESS_KEY_SECRET),
    SMS_SIGN_NAME: stripQuotes(process.env.SMS_SIGN_NAME),
    SMS_TEMPLATE_CODE: stripQuotes(process.env.SMS_TEMPLATE_CODE),
    LLM_API_KEY: stripQuotes(process.env.LLM_API_KEY),
    LLM_ALLOWED_HOSTS: stripQuotes(process.env.LLM_ALLOWED_HOSTS),
    ID_CARD_ENCRYPTION_KEY: stripQuotes(process.env.ID_CARD_ENCRYPTION_KEY),
    DINGTALK_LINK_GATEWAY: stripQuotes(process.env.DINGTALK_LINK_GATEWAY),
    RATE_LIMIT_REPORT_GENERATE: stripQuotes(
      process.env.RATE_LIMIT_REPORT_GENERATE,
    ),
    RATE_LIMIT_QUESTION_GENERATE: stripQuotes(
      process.env.RATE_LIMIT_QUESTION_GENERATE,
    ),
    RATE_LIMIT_DRAW: stripQuotes(process.env.RATE_LIMIT_DRAW),
    RATE_LIMIT_UPLOAD: stripQuotes(process.env.RATE_LIMIT_UPLOAD),
    RATE_LIMIT_DINGTALK_USER_INFO: stripQuotes(
      process.env.RATE_LIMIT_DINGTALK_USER_INFO,
    ),
    CRON_SECRET: stripQuotes(process.env.CRON_SECRET),
    RATE_LIMIT_GLOBAL_IP: stripQuotes(process.env.RATE_LIMIT_GLOBAL_IP),
    RATE_LIMIT_AUTH_IP: stripQuotes(process.env.RATE_LIMIT_AUTH_IP),
    NEXT_PUBLIC_SITE_NAME: stripQuotes(process.env.NEXT_PUBLIC_SITE_NAME),
    NEXT_PUBLIC_MODULE_NAMES: stripQuotes(process.env.NEXT_PUBLIC_MODULE_NAMES),
    NEXT_PUBLIC_DEFAULT_MODULE: stripQuotes(
      process.env.NEXT_PUBLIC_DEFAULT_MODULE,
    ),
    NEXT_PUBLIC_ENABLED_MODULES: stripQuotes(
      process.env.NEXT_PUBLIC_ENABLED_MODULES,
    ),
    NEXT_PUBLIC_AUTH_METHOD: stripQuotes(process.env.NEXT_PUBLIC_AUTH_METHOD),
  },

  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
