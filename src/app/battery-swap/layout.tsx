// battery-swap 保持自有布局，不使用共享 Header/Footer
export default function BatterySwapLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
