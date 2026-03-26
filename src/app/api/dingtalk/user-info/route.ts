import { getDingtalkUserInfo } from '@/server/services/dingtalk';
import { dingtalkUserInfoLimiter } from '@/server/services/rate-limiter';

/**
 * @openapi
 * /user-info:
 *   post:
 *     summary: 免登获取用户信息
 *     description: |
 *       通过钉钉免登授权码（authCode）获取用户完整信息，包括姓名、手机号、部门、职位、工号。
 *       内部依次调用 GET_USER_INFO_BY_AUTHCODE 和 DINGTALK_USER_INFO_GET 两个 LINK 网关接口。
 *     tags:
 *       - 用户
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - authCode
 *             properties:
 *               authCode:
 *                 type: string
 *                 description: 钉钉免登授权码，通过前端 JSAPI dd.runtime.permission.requestAuthCode 获取，有效期 5 分钟，仅可使用一次
 *                 example: 74befcaddd4a3c02a05d79e07afc04df
 *     responses:
 *       200:
 *         description: 成功返回用户信息
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   description: 钉钉用户完整信息
 *                   properties:
 *                     name:
 *                       type: string
 *                       description: 姓名
 *                       example: 张三
 *                     userid:
 *                       type: string
 *                       description: 钉钉用户 ID
 *                       example: '024xxxxxxxxxxxx912'
 *                     mobile:
 *                       type: string
 *                       description: 手机号
 *                       example: '13800138000'
 *                     position:
 *                       type: string
 *                       description: 职位
 *                       example: 前端工程师
 *                     department:
 *                       type: string
 *                       description: 部门 ID 列表
 *                       example: '[88888888,666666]'
 *                     jobNumber:
 *                       type: string
 *                       description: 工号
 *                       example: '68686868'
 *       400:
 *         description: 参数错误
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 errorMsg:
 *                   type: string
 *                   example: 缺少 authCode 参数
 *       500:
 *         description: 服务端错误（LINK 网关调用失败等）
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 errorMsg:
 *                   type: string
 *                   example: 服务器内部错误
 */
export async function POST(request: Request) {
  try {
    // IP 级速率限制
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown';
    const rateCheck = dingtalkUserInfoLimiter.check(`dingtalk-user:${ip}`);
    if (!rateCheck.allowed) {
      return Response.json(
        { success: false, errorMsg: '请求过于频繁，请稍后再试' },
        { status: 429 },
      );
    }

    const body = (await request.json()) as { authCode?: string };

    if (!body.authCode) {
      return Response.json(
        { success: false, errorMsg: '缺少 authCode 参数' },
        { status: 400 },
      );
    }

    const data = await getDingtalkUserInfo(body.authCode);

    return Response.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器内部错误';
    console.error('[dingtalk/user-info]', message);
    return Response.json(
      { success: false, errorMsg: message },
      { status: 500 },
    );
  }
}
