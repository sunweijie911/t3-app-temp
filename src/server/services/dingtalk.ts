import { env } from '@/env';

// ---------- 类型定义 ----------

/** LINK 网关通用响应结构 */
interface LinkGatewayResponse<T = unknown> {
  success: string;
  errorCode: string;
  errorMsg?: string;
  data?: T;
}

/** GET_USER_INFO_BY_AUTHCODE 返回的用户基础信息 */
export interface DingtalkAuthUser {
  name: string;
  userid: string;
}

/** DINGTALK_USER_INFO_GET 返回的用户详细信息 */
export interface DingtalkUserDetail {
  name: string;
  mobile: string;
  position: string;
  department: string;
  jobNumber: string;
}

/** 组合后的完整用户信息 */
export type DingtalkUserInfo = DingtalkAuthUser & DingtalkUserDetail;

// ---------- 工具函数 ----------

/**
 * 手机号脱敏：13800138000 → 138****8000。
 * 长度不足 7 位时无法安全脱敏，原样返回。
 */
export function maskPhone(phone: string): string {
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

// ---------- 通用网关调用 ----------

/**
 * 调用 LINK 网关接口。
 *
 * @param apiName LINK API 名称，如 GET_USER_INFO_BY_AUTHCODE
 * @param params  请求参数（会序列化为 JSON 放在请求体中）
 */
async function callLinkGateway<T>(
  apiName: string,
  params: Record<string, unknown>,
): Promise<T> {
  const gateway = `${env.DINGTALK_LINK_GATEWAY}?apiName=${encodeURIComponent(apiName)}`;
  // 请求参数含 authCode / userId 等敏感信息，日志只记 apiName
  console.log(`[钉钉] callLinkGateway: ${apiName}`);

  const res = await fetch(gateway, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(
      `[钉钉] LINK 网关 HTTP 错误: ${res.status} ${res.statusText}`,
      text,
    );
    throw new Error(
      `[钉钉] LINK 网关请求失败: HTTP ${res.status} ${res.statusText}`,
    );
  }

  const result = (await res.json()) as LinkGatewayResponse<T>;
  // data 中含手机号等个人信息，日志只记调用结果元信息
  console.log(
    `[钉钉] ${apiName} 响应: success=${result.success} errorCode=${result.errorCode} errorMsg=${result.errorMsg ?? ''}`,
  );

  if (result.success !== 'true' || !result.data) {
    throw new Error(
      `[钉钉] ${apiName} 调用失败 [${result.errorCode}]: ${result.errorMsg ?? '未知错误'}`,
    );
  }

  return result.data;
}

// ---------- 具体接口 ----------

/**
 * 通过免登授权码获取用户基础信息（name + userid）。
 */
export async function getUserByAuthCode(
  authCode: string,
): Promise<DingtalkAuthUser> {
  return callLinkGateway<DingtalkAuthUser>('GET_USER_INFO_BY_AUTHCODE', {
    authCode,
  });
}

/**
 * 通过 userId 获取用户详细信息（姓名、手机号、部门、职位、工号）。
 */
export async function getUserDetail(
  userId: string,
): Promise<DingtalkUserDetail> {
  return callLinkGateway<DingtalkUserDetail>('DINGTALK_USER_INFO_GET', {
    content: { userId },
  });
}

/**
 * 免登一步到位：authCode → 用户完整信息。
 *
 * 内部依次调用 getUserByAuthCode 和 getUserDetail。
 */
export async function getDingtalkUserInfo(
  authCode: string,
): Promise<DingtalkUserInfo> {
  const authUser = await getUserByAuthCode(authCode);
  const detail = await getUserDetail(authUser.userid);

  return {
    ...authUser,
    ...detail,
  };
}
