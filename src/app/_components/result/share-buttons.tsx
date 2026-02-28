'use client';

import { Copy } from 'lucide-react';
import { toast } from 'sonner';

export function ShareButtons({ shareToken }: { shareToken: string }) {
  const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/share/${shareToken}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('链接已复制到剪贴板');
    } catch {
      toast.error('复制失败，请手动复制链接');
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-gray-600 text-sm transition-colors hover:bg-gray-50"
        onClick={handleCopy}
        type="button"
      >
        <Copy className="h-4 w-4" />
        复制链接
      </button>
    </div>
  );
}
