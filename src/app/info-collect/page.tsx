'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  DEFAULT_ENABLED_FIELDS,
  ID_CARD_RE,
  PHONE_RE,
} from '@/modules/info-collect/constants';
import { api } from '@/trpc/react';

type FormState = {
  name: string;
  phone: string;
  idCard: string;
  proofImageUrl: string;
};

export default function InfoCollectPage() {
  const [form, setForm] = useState<FormState>({
    name: '',
    phone: '',
    idCard: '',
    proofImageUrl: '',
  });
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({});
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: config } = api.infoCollect.getConfig.useQuery();

  const enabledFields = config?.enabledFields ?? DEFAULT_ENABLED_FIELDS;
  const bannerUrl = config?.bannerUrl ?? null;

  const submitMutation = api.infoCollect.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      toast.success('提交成功！');
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  function validate(): boolean {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (enabledFields.includes('name')) {
      if (!form.name || form.name.length < 2 || form.name.length > 20)
        e.name = '姓名需 2-20 个字符';
    }
    if (!PHONE_RE.test(form.phone)) e.phone = '请输入有效的手机号';
    if (!ID_CARD_RE.test(form.idCard)) e.idCard = '请输入有效的身份证号';
    if (enabledFields.includes('proofImage')) {
      if (!form.proofImageUrl) e.proofImageUrl = '请上传在职证明截图';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleUpload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('图片大小不能超过 5MB');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast.error(data.error ?? '上传失败');
        return;
      }
      setForm((prev) => ({ ...prev, proofImageUrl: data.url ?? '' }));
      setPreview(URL.createObjectURL(file));
      setErrors((prev) => ({ ...prev, proofImageUrl: undefined }));
    } catch {
      toast.error('上传失败，请重试');
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    submitMutation.mutate({
      name: enabledFields.includes('name') ? form.name : undefined,
      phone: form.phone,
      idCard: form.idCard,
      proofImageUrl: enabledFields.includes('proofImage')
        ? form.proofImageUrl
        : undefined,
    });
  }

  if (submitted) {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-4"
        style={{
          background:
            'linear-gradient(180deg, #3B82F6 0%, #60A5FA 40%, #93C5FD 100%)',
        }}
      >
        <div
          className="w-full max-w-md rounded-2xl p-8 text-center"
          style={{
            backdropFilter: 'blur(30px)',
            WebkitBackdropFilter: 'blur(30px)',
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,1) 56%)',
          }}
        >
          <div className="mb-4 text-5xl">&#10004;</div>
          <h2 className="mb-2 font-bold text-gray-800 text-xl">提交成功</h2>
          <p className="mb-6 text-gray-500">您的信息已提交，我们将尽快审核。</p>
          <a
            className="inline-block rounded-lg bg-blue-500 px-6 py-2.5 font-medium text-white transition-colors hover:bg-blue-600"
            href="/info-collect/query"
          >
            查询进度
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center"
      style={{
        background:
          'linear-gradient(180deg, #3B82F6 0%, #60A5FA 40%, #93C5FD 100%)',
      }}
    >
      {/* Banner — 全宽铺满，独立于表单卡片 */}
      {bannerUrl && (
        // biome-ignore lint/performance/noImgElement: dynamic user-uploaded src, dimensions unknown
        <img alt="Banner" className="w-full object-cover" src={bannerUrl} />
      )}

      {/* 表单卡片 */}
      <div
        className={`w-full max-w-md px-4 ${bannerUrl ? 'mt-4' : 'mt-12'} pb-8`}
      >
        <div
          className="w-full rounded-2xl"
          style={{
            backdropFilter: 'blur(30px)',
            WebkitBackdropFilter: 'blur(30px)',
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,1) 56%)',
          }}
        >
          <div className="p-6">
            <h1 className="mb-1 text-center font-bold text-gray-800 text-xl">
              在职信息采集
            </h1>
            <p className="mb-6 text-center text-gray-400 text-sm">
              请如实填写以下信息
            </p>

            <form className="space-y-4" onSubmit={handleSubmit}>
              {/* 姓名 */}
              {enabledFields.includes('name') && (
                <label className="block">
                  <span className="mb-1 block font-medium text-gray-700 text-sm">
                    姓名 <span className="text-red-500">*</span>
                  </span>
                  <input
                    className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${errors.name ? 'border-red-400' : 'border-gray-300'}`}
                    maxLength={20}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="请输入真实姓名"
                    type="text"
                    value={form.name}
                  />
                  {errors.name && (
                    <p className="mt-1 text-red-500 text-xs">{errors.name}</p>
                  )}
                </label>
              )}

              {/* 手机号 */}
              <label className="block">
                <span className="mb-1 block font-medium text-gray-700 text-sm">
                  手机号 <span className="text-red-500">*</span>
                </span>
                <input
                  className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${errors.phone ? 'border-red-400' : 'border-gray-300'}`}
                  inputMode="tel"
                  maxLength={11}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, phone: e.target.value }))
                  }
                  placeholder="请输入手机号"
                  type="tel"
                  value={form.phone}
                />
                {errors.phone && (
                  <p className="mt-1 text-red-500 text-xs">{errors.phone}</p>
                )}
              </label>

              {/* 身份证号 */}
              <label className="block">
                <span className="mb-1 block font-medium text-gray-700 text-sm">
                  身份证号 <span className="text-red-500">*</span>
                </span>
                <input
                  className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${errors.idCard ? 'border-red-400' : 'border-gray-300'}`}
                  maxLength={18}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      idCard: e.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="请输入18位身份证号"
                  type="text"
                  value={form.idCard}
                />
                {errors.idCard && (
                  <p className="mt-1 text-red-500 text-xs">{errors.idCard}</p>
                )}
              </label>

              {/* 在职证明上传 */}
              {enabledFields.includes('proofImage') && (
                <div>
                  <span className="mb-1 block font-medium text-gray-700 text-sm">
                    在职证明截图 <span className="text-red-500">*</span>
                  </span>
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleUpload(file);
                    }}
                    ref={fileRef}
                    type="file"
                  />
                  {preview || form.proofImageUrl ? (
                    <div className="relative">
                      {/* biome-ignore lint/performance/noImgElement: blob URL preview, not optimizable */}
                      <img
                        alt="在职证明预览"
                        className="w-full rounded-lg border border-gray-200 object-cover"
                        src={preview ?? form.proofImageUrl}
                        style={{ maxHeight: 200 }}
                      />
                      <button
                        className="absolute top-2 right-2 rounded-full bg-black/50 px-2 py-0.5 text-white text-xs hover:bg-black/70"
                        onClick={() => {
                          setPreview(null);
                          setForm((prev) => ({ ...prev, proofImageUrl: '' }));
                          if (fileRef.current) fileRef.current.value = '';
                        }}
                        type="button"
                      >
                        重选
                      </button>
                    </div>
                  ) : (
                    <button
                      className={`w-full rounded-lg border-2 border-dashed py-8 text-center text-sm transition-colors hover:border-blue-400 hover:text-blue-500 ${
                        errors.proofImageUrl
                          ? 'border-red-400 text-red-400'
                          : 'border-gray-300 text-gray-400'
                      }`}
                      disabled={uploading}
                      onClick={() => fileRef.current?.click()}
                      type="button"
                    >
                      {uploading ? '上传中...' : '点击上传在职证明截图'}
                      <br />
                      <span className="text-xs">
                        支持 jpg/png/webp，最大 5MB
                      </span>
                    </button>
                  )}
                  {errors.proofImageUrl && !form.proofImageUrl && (
                    <p className="mt-1 text-red-500 text-xs">
                      {errors.proofImageUrl}
                    </p>
                  )}
                </div>
              )}

              {/* 提交按钮 */}
              <button
                className="w-full rounded-lg bg-blue-500 py-3 font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={submitMutation.isPending || uploading}
                type="submit"
              >
                {submitMutation.isPending ? '提交中...' : '提交信息'}
              </button>

              <p className="text-center text-gray-400 text-xs">
                提交后可通过手机号查询审核进度
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
