import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { nanoid } from 'nanoid';
import { NextResponse } from 'next/server';

import { auth } from '@/server/better-auth';
import { uploadLimiter } from '@/server/services/rate-limiter';

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown';
  return request.headers.get('x-real-ip') ?? 'unknown';
}

// 通过文件头魔术字节判断真实格式，不依赖客户端提供的 MIME type
function detectImageType(buffer: Buffer): { ext: string; mime: string } | null {
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return { ext: 'png', mime: 'image/png' };
  }
  // WebP: RIFF....WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

export async function POST(request: Request) {
  try {
    // 优先使用 session userId 限流；未登录时降级为 IP 限流
    // 信息采集表单是公开页面，不要求登录
    const session = await auth.api.getSession({ headers: request.headers });
    const rateLimitKey = session?.user?.id ?? `ip:${getClientIp(request)}`;

    const rateCheck = uploadLimiter.check(rateLimitKey);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: `上传过于频繁，请 ${Math.ceil(rateCheck.retryAfterMs / 1000)} 秒后重试`,
        },
        { status: 429 },
      );
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: '请选择文件' }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: '图片大小不能超过 5MB' },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // 用魔术字节检测真实文件类型
    const detected = detectImageType(buffer);
    if (!detected) {
      return NextResponse.json(
        { error: '仅支持 jpg/png/webp 格式图片' },
        { status: 400 },
      );
    }

    const ALLOWED_MODULES = ['info-collect', 'battery-swap'] as const;
    const url = new URL(request.url);
    const moduleParam = url.searchParams.get('module') ?? 'info-collect';
    const module = ALLOWED_MODULES.includes(
      moduleParam as (typeof ALLOWED_MODULES)[number],
    )
      ? moduleParam
      : 'info-collect';

    const fileName = `${Date.now()}-${nanoid()}.${detected.ext}`;
    const uploadDir = join(process.cwd(), 'public', 'uploads', module);

    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(uploadDir, fileName), buffer);

    return NextResponse.json({ url: `/uploads/${module}/${fileName}` });
  } catch {
    return NextResponse.json({ error: '上传失败，请重试' }, { status: 500 });
  }
}
