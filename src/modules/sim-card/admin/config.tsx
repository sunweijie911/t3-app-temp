'use client';

import { Checkbox } from 'antd';
import { toast } from 'sonner';

import { MODULE_NAME, USER_INFO_FIELDS } from '@/modules/sim-card/constants';
import { ImageUploader } from '@/shared/components/admin/image-uploader';
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
          <ImageUploader
            height={80}
            module="sim-card"
            onChange={(url) => saveMutation.mutate({ bannerUrl: url ?? '' })}
            value={config?.bannerUrl ?? null}
            width={240}
          />
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
