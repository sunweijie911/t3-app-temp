'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useDefaultModuleId } from '@/app/_components/default-module-provider';
import { getAllModules } from '@/modules/registry';
import { api } from '@/trpc/react';

export function DefaultModuleSelector() {
  const router = useRouter();
  const contextDefault = useDefaultModuleId();
  const modules = getAllModules();

  const { data: dbValue, isLoading } = api.admin.getConfig.useQuery(
    { key: 'app.default_module' },
    { select: (d) => (d.value != null ? String(d.value) : null) },
  );

  const currentValue = dbValue ?? contextDefault;

  const setConfig = api.admin.setConfig.useMutation({
    onSuccess: () => {
      toast.success('默认首页模块已更新');
      router.refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="flex items-center gap-3">
      <label
        className="font-medium text-gray-700 text-sm"
        htmlFor="default-module"
      >
        默认首页模块
      </label>
      <select
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
        disabled={isLoading || setConfig.isPending}
        id="default-module"
        onChange={(e) =>
          setConfig.mutate({
            key: 'app.default_module',
            value: e.target.value,
            description: '首页默认展示的模块 ID',
          })
        }
        value={currentValue}
      >
        {modules.map((mod) => (
          <option key={mod.id} value={mod.id}>
            {mod.name}
          </option>
        ))}
      </select>
      {setConfig.isPending && (
        <span className="text-gray-400 text-xs">保存中...</span>
      )}
    </div>
  );
}
