'use client';

import { DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Checkbox, Image, Popconfirm, Space, Upload } from 'antd';
import { useState } from 'react';
import { toast } from 'sonner';

import { MODULE_NAME, USER_INFO_FIELDS } from '@/modules/sim-card/constants';
import { api } from '@/trpc/react';

export default function AdminSimCardConfigPage() {
  const { data: config, refetch } = api.simCard.admin.getConfig.useQuery();
  const saveMutation = api.simCard.admin.saveConfig.useMutation({
    onSuccess: () => {
      toast.success('配置已保存');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const [uploadingBanner, setUploadingBanner] = useState(false);

  // ── Banner 上传 ──────────────────────────────────

  async function handleBannerUpload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Banner 图片不能超过 5MB');
      return;
    }
    setUploadingBanner(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload?module=sim-card', {
        method: 'POST',
        body: fd,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast.error(data.error ?? '上传失败');
        return;
      }
      saveMutation.mutate({ bannerUrl: data.url });
    } catch {
      toast.error('上传失败，请重试');
    } finally {
      setUploadingBanner(false);
    }
  }

  // ── 字段勾选 ──────────────────────────────────────

  function handleFieldsChange(checkedValues: string[]) {
    saveMutation.mutate({ visibleFields: checkedValues });
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="mb-8 font-bold text-2xl text-gray-900">
          {MODULE_NAME} - 页面配置
        </h1>

        {/* Banner 配置 */}
        <div className="mb-8 rounded-xl bg-white p-6">
          <h2 className="mb-4 font-semibold text-gray-700 text-lg">
            页面 Banner
          </h2>
          <div className="flex items-center gap-4">
            {config?.bannerUrl ? (
              <Image
                alt="Banner"
                height={80}
                src={config.bannerUrl}
                style={{ borderRadius: 8, objectFit: 'cover' }}
                width={240}
              />
            ) : (
              <div className="flex h-20 w-60 items-center justify-center rounded-lg border border-gray-300 border-dashed text-gray-400 text-sm">
                未设置 Banner
              </div>
            )}
            <Space>
              <Upload
                accept="image/*"
                beforeUpload={(file) => {
                  void handleBannerUpload(file);
                  return false;
                }}
                showUploadList={false}
              >
                <Button icon={<UploadOutlined />} loading={uploadingBanner}>
                  {config?.bannerUrl ? '更换 Banner' : '上传 Banner'}
                </Button>
              </Upload>
              {config?.bannerUrl && (
                <Popconfirm
                  onConfirm={() => saveMutation.mutate({ bannerUrl: '' })}
                  title="确定删除 Banner 吗？"
                >
                  <Button danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>
              )}
            </Space>
          </div>
        </div>

        {/* 用户信息字段配置 */}
        <div className="rounded-xl bg-white p-6">
          <h2 className="mb-2 font-semibold text-gray-700 text-lg">
            前台展示的用户信息字段
          </h2>
          <p className="mb-4 text-gray-400 text-sm">
            勾选需要在前台页面展示的钉钉用户信息字段
          </p>

          {config && (
            <Checkbox.Group
              onChange={handleFieldsChange}
              value={config.visibleFields}
            >
              <div className="space-y-3">
                {USER_INFO_FIELDS.map((field) => (
                  <div key={field.key}>
                    <Checkbox value={field.key}>{field.label}</Checkbox>
                  </div>
                ))}
              </div>
            </Checkbox.Group>
          )}
        </div>
      </div>
    </main>
  );
}
