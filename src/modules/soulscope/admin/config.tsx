'use client';

import {
  Breadcrumb,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Spin,
  Typography,
} from 'antd';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MODULE_NAME } from '@/modules/soulscope/constants';
import { api } from '@/trpc/react';

type ConfigType = 'text' | 'password' | 'number' | 'textarea';

type ConfigDef = { configKey: string; label: string; type: ConfigType };

const LLM_CONFIGS: ConfigDef[] = [
  { configKey: 'llm.base_url', label: 'API 地址', type: 'text' },
  { configKey: 'llm.api_key', label: 'API 密钥', type: 'password' },
  { configKey: 'llm.model', label: '模型名称', type: 'text' },
  { configKey: 'llm.temperature', label: 'Temperature', type: 'number' },
  { configKey: 'llm.max_tokens', label: 'Max Tokens', type: 'number' },
];

const REPORT_CONFIGS: ConfigDef[] = [
  { configKey: 'report.system_prompt', label: '系统提示词', type: 'textarea' },
  { configKey: 'report.price', label: '报告价格（元）', type: 'number' },
];

function ConfigItem({ configKey, label, type }: ConfigDef) {
  const [value, setValue] = useState<string | number>('');
  const utils = api.useUtils();

  const { data, isLoading } = api.sys.getConfig.useQuery(
    { key: configKey },
    { retry: false },
  );

  const setConfig = api.sys.setConfig.useMutation({
    onSuccess: () => {
      toast.success(`${label} 已保存`);
      void utils.sys.getConfig.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    if (data?.value !== undefined) {
      setValue(
        typeof data.value === 'string'
          ? data.value
          : JSON.stringify(data.value),
      );
    }
  }, [data]);

  const handleSave = () => {
    let parsed: string | number | boolean = value;
    if (
      typeof value === 'string' &&
      !Number.isNaN(Number(value)) &&
      value.trim() !== ''
    ) {
      parsed = Number(value);
    }
    setConfig.mutate({ key: configKey, value: parsed });
  };

  return (
    <Form.Item
      label={
        <span>
          {label}
          <Typography.Text
            style={{ fontSize: 12, marginLeft: 6 }}
            type="secondary"
          >
            {configKey}
          </Typography.Text>
        </span>
      }
    >
      <div style={{ display: 'flex', gap: 8 }}>
        {isLoading ? (
          <Spin size="small" style={{ flex: 1 }} />
        ) : type === 'textarea' ? (
          <Input.TextArea
            onChange={(e) => setValue(e.target.value)}
            rows={6}
            style={{ flex: 1 }}
            value={value as string}
          />
        ) : type === 'password' ? (
          <Input.Password
            onChange={(e) => setValue(e.target.value)}
            style={{ flex: 1 }}
            value={value as string}
          />
        ) : type === 'number' ? (
          <InputNumber
            onChange={(val) => setValue(val ?? '')}
            style={{ flex: 1 }}
            value={value === '' ? undefined : Number(value)}
          />
        ) : (
          <Input
            onChange={(e) => setValue(e.target.value)}
            style={{ flex: 1 }}
            value={value as string}
          />
        )}
        <Button
          loading={setConfig.isPending}
          onClick={handleSave}
          type="primary"
        >
          保存
        </Button>
      </div>
    </Form.Item>
  );
}

function ConfigSection({
  title,
  configs,
}: {
  title: string;
  configs: ConfigDef[];
}) {
  return (
    <Card style={{ marginBottom: 24 }} title={title}>
      <Form layout="vertical">
        {configs.map((config) => (
          <ConfigItem key={config.configKey} {...config} />
        ))}
      </Form>
    </Card>
  );
}

export default function AdminConfigPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <div style={{ maxWidth: 896, margin: '0 auto', padding: '48px 24px' }}>
        <Breadcrumb
          items={[
            { title: <Link href="/admin/soulscope">{MODULE_NAME} 管理</Link> },
            { title: '系统配置' },
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
          系统配置
        </h1>

        <ConfigSection configs={LLM_CONFIGS} title="LLM 配置" />
        <ConfigSection configs={REPORT_CONFIGS} title="报告配置" />
      </div>
    </main>
  );
}
