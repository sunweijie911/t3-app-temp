// sim-card 保持自有布局，不使用共享 Header/Footer（钉钉H5内嵌页面）
export default function SimCardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
