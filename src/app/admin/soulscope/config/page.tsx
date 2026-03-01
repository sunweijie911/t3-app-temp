'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Header } from '@/app/_components/layout/header';
import { api } from '@/trpc/react';

const CONFIG_KEYS = [
  { key: 'llm.base_url', label: 'LLM API地址', type: 'text' as const },
  { key: 'llm.api_key', label: 'LLM API密钥', type: 'password' as const },
  { key: 'llm.model', label: '模型名称', type: 'text' as const },
  { key: 'llm.temperature', label: 'Temperature', type: 'number' as const },
  { key: 'llm.max_tokens', label: 'Max Tokens', type: 'number' as const },
  {
    key: 'report.system_prompt',
    label: '系统提示词',
    type: 'textarea' as const,
  },
  { key: 'report.price', label: '报告价格', type: 'number' as const },
];

function ConfigItem({
  configKey,
  label,
  type,
}: {
  configKey: string;
  label: string;
  type: string;
}) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const utils = api.useUtils();

  const { data } = api.admin.getConfig.useQuery(
    { key: configKey },
    { retry: false },
  );

  const setConfig = api.admin.setConfig.useMutation({
    onSuccess: () => {
      void utils.admin.getConfig.invalidate();
      setSaving(false);
    },
    onError: () => setSaving(false),
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
    setSaving(true);
    let parsed: string | number | boolean = value;
    if (!Number.isNaN(Number(value)) && value.trim() !== '') {
      parsed = Number(value);
    }
    setConfig.mutate({ key: configKey, value: parsed });
  };

  return (
    <div className="rounded-xl bg-white p-6 shadow-sm">
      <label
        className="mb-2 block font-medium text-gray-900 text-sm"
        htmlFor={`config-${configKey}`}
      >
        {label}
        <span className="ml-2 text-gray-400 text-xs">{configKey}</span>
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        {type === 'textarea' ? (
          <textarea
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
            id={`config-${configKey}`}
            onChange={(e) => setValue(e.target.value)}
            rows={6}
            value={value}
          />
        ) : (
          <input
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
            id={`config-${configKey}`}
            onChange={(e) => setValue(e.target.value)}
            type={type}
            value={value}
          />
        )}
        <button
          className="rounded-lg bg-purple-600 px-4 py-2 font-medium text-sm text-white hover:bg-purple-700 disabled:opacity-50"
          disabled={saving}
          onClick={handleSave}
          type="button"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}

export default function AdminConfigPage() {
  return (
    <>
      <Header />
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
          <Link
            className="text-purple-600 text-sm hover:text-purple-700"
            href="/admin/soulscope"
          >
            &larr; 返回管理后台
          </Link>
          <h1 className="mt-2 mb-8 font-bold text-3xl text-gray-900">
            系统配置
          </h1>

          <div className="space-y-6">
            {CONFIG_KEYS.map((config) => (
              <ConfigItem
                configKey={config.key}
                key={config.key}
                label={config.label}
                type={config.type}
              />
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
