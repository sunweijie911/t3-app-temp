'use client';

import { DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import {
  Breadcrumb,
  Button,
  Card,
  Form,
  Image,
  Spin,
  Typography,
  Upload,
} from 'antd';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MODULE_NAME } from '@/modules/info-collect/constants';
import { api } from '@/trpc/react';

export default function AdminInfoCollectConfigPage() {
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: config, isLoading } =
    api.infoCollect.admin.getConfig.useQuery();
  const utils = api.useUtils();

  const saveMutation = api.infoCollect.admin.saveConfig.useMutation({
    onSuccess: () => {
      toast.success('配置已保存');
      void utils.infoCollect.admin.getConfig.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    if (config) {
      setBannerUrl(config.bannerUrl ?? null);
    }
  }, [config]);

  async function handleBannerUpload(file: File) {
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
      setBannerUrl(data.url);
    } catch {
      toast.error('上传失败，请重试');
    } finally {
      setUploading(false);
    }
  }

  function handleSave() {
    saveMutation.mutate({ bannerUrl });
  }

  if (isLoading) {
    return (
      <main style={{ minHeight: '100vh', background: '#f5f5f5' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            paddingTop: 120,
          }}
        >
          <Spin size="large" />
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <div style={{ maxWidth: 896, margin: '0 auto', padding: '48px 24px' }}>
        <Breadcrumb
          items={[
            {
              title: <Link href="/admin/info-collect">{MODULE_NAME}管理</Link>,
            },
            { title: '采集配置' },
          ]}
          style={{ marginBottom: 8 }}
        />
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: '#111827',
            marginBottom: 32,
          }}
        >
          采集配置
        </h1>

        {/* Banner 配置 */}
        <Card style={{ marginBottom: 24 }} title="Banner 配置">
          <Form layout="vertical">
            <Form.Item label="顶部 Banner 图">
              {bannerUrl ? (
                <div style={{ marginBottom: 12 }}>
                  <Image
                    alt="Banner 预览"
                    src={bannerUrl}
                    style={{
                      maxWidth: '100%',
                      maxHeight: 200,
                      borderRadius: 8,
                      objectFit: 'cover',
                    }}
                  />
                  <div style={{ marginTop: 8 }}>
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => setBannerUrl(null)}
                      size="small"
                    >
                      清除 Banner
                    </Button>
                  </div>
                </div>
              ) : (
                <Upload
                  accept="image/jpeg,image/png,image/webp"
                  beforeUpload={(file) => {
                    void handleBannerUpload(file);
                    return false;
                  }}
                  showUploadList={false}
                >
                  <Button icon={<UploadOutlined />} loading={uploading}>
                    {uploading ? '上传中...' : '点击上传 Banner 图'}
                  </Button>
                </Upload>
              )}
              <Typography.Text
                style={{ display: 'block', marginTop: 4 }}
                type="secondary"
              >
                建议尺寸 750×300，支持 jpg/png/webp，最大 5MB。留空则不显示
                Banner。
              </Typography.Text>
            </Form.Item>
          </Form>
        </Card>

        {/* 保存按钮 */}
        <div style={{ textAlign: 'right' }}>
          <Button
            loading={saveMutation.isPending}
            onClick={handleSave}
            size="large"
            type="primary"
          >
            保存配置
          </Button>
        </div>
      </div>
    </main>
  );
}
