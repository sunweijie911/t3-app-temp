'use client';

import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';

// antd 主题配置：对齐大转盘橙色系
const theme = {
  token: {
    colorPrimary: '#FF6B3D',
    colorLink: '#FF6B3D',
    borderRadius: 6,
  },
};

export function AdminAntdProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider locale={zhCN} theme={theme}>
      <App>{children}</App>
    </ConfigProvider>
  );
}
