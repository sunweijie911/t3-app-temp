export function Footer() {
  return (
    <footer className="border-gray-200 border-t bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="text-gray-500 text-sm">
            &copy; {new Date().getFullYear()} SoulScope. 探索内心，认识自我。
          </p>
          <p className="text-gray-400 text-xs">
            分析报告仅供参考，不构成专业心理诊断
          </p>
        </div>
      </div>
    </footer>
  );
}
