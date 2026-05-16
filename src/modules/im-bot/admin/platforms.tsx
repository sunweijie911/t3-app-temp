'use client';

import { CopyOutlined } from '@ant-design/icons';
import { Button, Card, Flex, Form, Input, Switch, Tooltip } from 'antd';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/trpc/react';
import { type BotPlatform, PLATFORM_LABELS } from '../constants';

const PLATFORM_FIELDS: Record<
  BotPlatform,
  { key: string; label: string; secret?: boolean }[]
> = {
  feishu: [
    { key: 'appId', label: 'App ID' },
    { key: 'appSecret', label: 'App Secret', secret: true },
    { key: 'encryptKey', label: 'Encrypt Key', secret: true },
    {
      key: 'verificationToken',
      label: 'Verification Token (可选)',
      secret: true,
    },
  ],
  dingtalk: [
    { key: 'appKey', label: 'App Key' },
    { key: 'appSecret', label: 'App Secret', secret: true },
    { key: 'robotCode', label: 'Robot Code' },
    { key: 'botSecret', label: 'Bot Secret', secret: true },
  ],
  wecom: [
    { key: 'corpId', label: 'Corp ID' },
    { key: 'botSecret', label: 'Bot Secret', secret: true },
    { key: 'botToken', label: 'Bot Token', secret: true },
    { key: 'encodingAesKey', label: 'Encoding AES Key', secret: true },
  ],
};

function PlatformCard({
  platform,
  data,
  onSave,
  saving,
}: {
  platform: BotPlatform;
  data?: { id: string; credentials: unknown; isActive: boolean };
  onSave: (values: {
    platform: BotPlatform;
    name: string;
    credentials: Record<string, unknown>;
    isActive: boolean;
    id?: string;
  }) => void;
  saving?: boolean;
}) {
  const fields = PLATFORM_FIELDS[platform];
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (data) {
      setCreds((data.credentials as Record<string, string>) ?? {});
      setActive(data.isActive);
    }
  }, [data]);

  // 用 useEffect 在挂载后计算，避免 SSR(相对路径) 与 CSR(绝对路径) 不一致触发
  // hydration warning（Antd 受控 Input.value 不一致还会有一次视觉闪烁）
  const [webhookUrl, setWebhookUrl] = useState(`/api/bot/${platform}/webhook`);
  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/bot/${platform}/webhook`);
  }, [platform]);

  const disabled = platform !== 'feishu';

  return (
    <Card
      extra={
        <Switch checked={active} disabled={disabled} onChange={setActive} />
      }
      style={{ marginBottom: 16 }}
      title={`${PLATFORM_LABELS[platform]}${disabled ? ' (TODO: Phase 3)' : ''}`}
    >
      <Form autoComplete="off" layout="vertical">
        {fields.map((f) => (
          <Form.Item key={f.key} label={f.label}>
            {f.secret ? (
              <Input.Password
                autoComplete="off"
                disabled={disabled}
                onChange={(e) =>
                  setCreds({ ...creds, [f.key]: e.target.value })
                }
                placeholder={disabled ? '待实现' : undefined}
                value={creds[f.key] ?? ''}
              />
            ) : (
              <Input
                disabled={disabled}
                onChange={(e) =>
                  setCreds({ ...creds, [f.key]: e.target.value })
                }
                placeholder={disabled ? '待实现' : undefined}
                value={creds[f.key] ?? ''}
              />
            )}
          </Form.Item>
        ))}
        <Form.Item label="Webhook URL (只读，复制后填入飞书开放平台)">
          <Flex gap={8}>
            <Input readOnly value={webhookUrl} />
            <Tooltip title="复制">
              <Button
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard
                    .writeText(webhookUrl)
                    .then(() => toast.success('已复制'));
                }}
              />
            </Tooltip>
          </Flex>
        </Form.Item>
        <Button
          disabled={disabled}
          loading={saving}
          onClick={() =>
            onSave({
              id: data?.id,
              platform,
              name: PLATFORM_LABELS[platform],
              credentials: creds,
              isActive: active,
            })
          }
          type="primary"
        >
          保存
        </Button>
      </Form>
    </Card>
  );
}

export default function ImBotPlatformsPage() {
  const { data: platforms, refetch } = api.imBot.admin.listPlatforms.useQuery();

  const upsertMutation = api.imBot.admin.upsertPlatform.useMutation({
    onSuccess: () => {
      toast.success('保存成功');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const platformMap = new Map(platforms?.map((p) => [p.platform, p]));

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="mb-6 font-bold text-2xl text-gray-900">平台配置</h1>
        <Flex gap={16} vertical>
          {(['feishu', 'dingtalk', 'wecom'] as BotPlatform[]).map((p) => (
            <PlatformCard
              data={platformMap.get(p)}
              key={p}
              onSave={(values) => upsertMutation.mutate(values)}
              platform={p}
              saving={upsertMutation.isPending}
            />
          ))}
        </Flex>
      </div>
    </main>
  );
}
