'use client';

import { Modal, Select, Typography } from 'antd';
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
    onSuccess: (_, variables) => {
      const newId = variables.value as string;
      setContextModuleId(newId);
      toast.success('默认首页模块已更新');
      router.push(`/admin/${newId}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleChange = (id: string) => {
    const moduleName = modules.find((m) => m.id === id)?.name ?? id;
    Modal.confirm({
      title: '确认修改默认首页',
      content: `确定将默认首页切换为「${moduleName}」吗？此操作会影响所有用户的访问入口。`,
      okText: '确认切换',
      cancelText: '取消',
      onOk: () => {
        setConfig.mutate({
          key: 'app.default_module',
          value: id,
          description: '首页默认展示的模块 ID',
        });
      },
    });
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
