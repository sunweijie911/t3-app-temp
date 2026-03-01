import Image from 'next/image';
import Link from 'next/link';

interface ActivityCardProps {
  activity: {
    slug: string;
    name: string;
    description: string | null;
    coverImage: string | null;
    startAt: Date | null;
    endAt: Date | null;
  };
}

export function ActivityCard({ activity }: ActivityCardProps) {
  const isEnded = activity.endAt && new Date() > activity.endAt;

  return (
    <Link
      className="group block overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all hover:shadow-md"
      href={`/lucky-wheel/${activity.slug}`}
    >
      {activity.coverImage && (
        <div className="relative aspect-video overflow-hidden bg-gray-100">
          <Image
            alt={activity.name}
            className="object-cover transition-transform group-hover:scale-105"
            fill
            src={activity.coverImage}
          />
        </div>
      )}
      <div className="p-5">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="font-semibold text-gray-900 text-lg">
            {activity.name}
          </h3>
          {isEnded && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500 text-xs">
              已结束
            </span>
          )}
        </div>
        {activity.description && (
          <p className="line-clamp-2 text-gray-500 text-sm">
            {activity.description}
          </p>
        )}
        {(activity.startAt ?? activity.endAt) && (
          <p className="mt-3 text-gray-400 text-xs">
            {activity.startAt &&
              new Date(activity.startAt).toLocaleDateString()}
            {activity.startAt && activity.endAt && ' — '}
            {activity.endAt && new Date(activity.endAt).toLocaleDateString()}
          </p>
        )}
      </div>
    </Link>
  );
}
