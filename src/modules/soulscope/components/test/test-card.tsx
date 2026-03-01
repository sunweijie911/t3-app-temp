import { Clock, HelpCircle } from 'lucide-react';
import Link from 'next/link';

interface TestCardProps {
  slug: string;
  name: string;
  shortDescription: string;
  questionCount: number;
  estimatedMinutes: number;
  isFeatured: boolean;
  reportPrice: string;
}

export function TestCard({
  slug,
  name,
  shortDescription,
  questionCount,
  estimatedMinutes,
  isFeatured,
  reportPrice,
}: TestCardProps) {
  return (
    <Link className="group block" href={`/soulscope/tests/${slug}`}>
      <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:border-purple-300 hover:shadow-md">
        {isFeatured && (
          <span className="absolute top-3 right-3 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 px-3 py-1 font-medium text-white text-xs">
            热门
          </span>
        )}
        <h3 className="mb-2 font-semibold text-gray-900 text-lg group-hover:text-purple-600">
          {name}
        </h3>
        <p className="mb-4 line-clamp-2 text-gray-500 text-sm">
          {shortDescription}
        </p>
        <div className="flex items-center justify-between text-gray-400 text-xs">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <HelpCircle className="h-3.5 w-3.5" />
              {questionCount} 题
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />约{estimatedMinutes}分钟
            </span>
          </span>
          <span className="font-medium text-purple-600">
            报告 &yen;{reportPrice}
          </span>
        </div>
      </div>
    </Link>
  );
}
