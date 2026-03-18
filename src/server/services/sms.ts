// cspell:words ALIYUN aliyun
import { createHmac, randomUUID } from 'node:crypto';
import { env } from '@/env';

const ALIYUN_ENDPOINT = 'https://dysmsapi.aliyuncs.com/';

/**
 * 按 RFC 3986 对字符串进行百分比编码（阿里云签名规范要求）。
 * encodeURIComponent 已处理大部分字符，仅 `!`、`'`、`(`、`)`、`*` 需要额外转义。
 */
function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

/** 构建阿里云 API 网关 HMAC-SHA1 签名。 */
function buildSignature(
  params: Record<string, string>,
  secret: string,
): string {
  const canonicalized = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k] ?? '')}`)
    .join('&');
  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonicalized)}`;
  return createHmac('sha1', `${secret}&`).update(stringToSign).digest('base64');
}

/**
 * 发送短信验证码。
 *
 * 开发环境：打印到控制台。
 * 生产环境：调用阿里云短信服务。需配置以下环境变量：
 *   SMS_ACCESS_KEY_ID、SMS_ACCESS_KEY_SECRET、SMS_SIGN_NAME、SMS_TEMPLATE_CODE
 *
 * 短信模板须包含 code 变量，例如：
 *   "您的验证码为：${code}，5分钟内有效，请勿泄露。"
 */
export async function sendSmsOtp(phone: string, code: string): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[SMS OTP] 手机号: ${phone} | 验证码: ${code}`);
    return;
  }

  const keyId = env.SMS_ACCESS_KEY_ID;
  const keySecret = env.SMS_ACCESS_KEY_SECRET;
  const signName = env.SMS_SIGN_NAME;
  const templateCode = env.SMS_TEMPLATE_CODE;

  if (!keyId || !keySecret || !signName || !templateCode) {
    throw new Error(
      '[SMS] 生产环境必须配置阿里云短信变量: SMS_ACCESS_KEY_ID, SMS_ACCESS_KEY_SECRET, SMS_SIGN_NAME, SMS_TEMPLATE_CODE',
    );
  }

  const params: Record<string, string> = {
    AccessKeyId: keyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    SignName: signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
  };
  params.Signature = buildSignature(params, keySecret);

  const res = await fetch(ALIYUN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });

  const data = (await res.json()) as { Code?: string; Message?: string };
  if (data.Code !== 'OK') {
    throw new Error(`短信发送失败 [${data.Code}]: ${data.Message}`);
  }
}
