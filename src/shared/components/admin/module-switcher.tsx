'use client';

import { Select, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getAllModules } from '@/modules/registry';
import { useSetDefaultModuleId } from '@/shared/components/default-module-provider';
import { api } from '@/trpc/react';

interface Props {
  currentModuleId: string;
}

export function ModuleSwitcher({ currentModuleId }: Props) {
  const router = useRouter();
  const modules = getAllModules();
  const setContextModuleId = useSetDefaultModuleId();

  const setConfig = api.sys.setConfig.useMutation({
    onSuccess: () => toast.success('默认首页模块已更新'),
    onError: (err) => toast.error(err.message),
  });

  const handleChange = (id: string) => {
    setContextModuleId(id);
    setConfig.mutate({
      key: 'app.default_module',
      value: id,
      description: '首页默认展示的模块 ID',
    });
    router.push(`/admin/${id}`);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Typography.Text style={{ fontSize: 13, color: '#6b7280' }}>
        默认首页
      </Typography.Text>
      <Select
        loading={setConfig.isPending}
        onChange={handleChange}
        options={modules.map((m) => ({ value: m.id, label: m.name }))}
        style={{ width: 160 }}
        value={currentModuleId}
      />
    </div>
  );
}
