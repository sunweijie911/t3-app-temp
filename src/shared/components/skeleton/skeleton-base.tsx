import type { CSSProperties, ReactNode } from 'react';

// 基础骨架块
export function SkeletonBlock({
  width,
  height,
  rounded = 'md',
  className = '',
  style,
}: {
  width?: string | number;
  height?: string | number;
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  className?: string;
  style?: CSSProperties;
}) {
  const roundedMap = {
    none: '',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    '2xl': 'rounded-2xl',
    full: 'rounded-full',
  };

  return (
    <div
      className={`animate-pulse bg-gray-200 ${roundedMap[rounded]} ${className}`}
      style={{ width, height, ...style }}
    />
  );
}

// 圆形骨架（头像等）
export function SkeletonCircle({
  size = 40,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse rounded-full bg-gray-200 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

// 文字行骨架
export function SkeletonText({
  lines = 3,
  widths,
  lineHeight = 16,
  gap = 12,
  className = '',
}: {
  lines?: number;
  widths?: (string | number)[];
  lineHeight?: number;
  gap?: number;
  className?: string;
}) {
  // 默认宽度模式：100%, 80%, 60%
  const defaultWidths = ['100%', '80%', '60%'];

  return (
    <div className={`flex flex-col ${className}`} style={{ gap }}>
      {Array.from({ length: lines }).map((_, i) => {
        const w =
          widths?.[i] ?? defaultWidths[i % defaultWidths.length] ?? '100%';
        return (
          <div
            className="animate-pulse rounded bg-gray-200"
            key={i}
            style={{ width: w, height: lineHeight }}
          />
        );
      })}
    </div>
  );
}

// 骨架容器（提供统一 padding 和间距）
export function SkeletonContainer({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`space-y-4 ${className}`}>{children}</div>;
}
