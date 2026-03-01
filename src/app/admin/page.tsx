import Link from 'next/link';
import { Header } from '@/app/_components/layout/header';
import { DefaultModuleSelector } from '@/app/admin/_components/default-module-selector';
import { getAllModules } from '@/modules/registry';
import { HydrateClient } from '@/trpc/server';

export const metadata = {
  title: '管理后台',
};

export default function AdminPage() {
  const modules = getAllModules();

  return (
    <HydrateClient>
      <Header />
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-center justify-between">
            <h1 className="font-bold text-3xl text-gray-900">管理后台</h1>
            <DefaultModuleSelector />
          </div>

          {/* Module Cards */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {modules.map((mod) => (
              <Link
                className="group rounded-xl bg-white p-6 shadow-sm transition-all hover:shadow-md"
                href={`/admin/${mod.id}`}
                key={mod.id}
              >
                <h2
                  className={`mb-1 font-bold text-gray-900 text-xl ${mod.theme.cardHover}`}
                >
                  {mod.name}
                </h2>
                <p className="mb-4 text-gray-500 text-sm">{mod.description}</p>
                <ul className="space-y-1">
                  {mod.adminNavItems.map((item) => (
                    <li className="text-gray-400 text-sm" key={item.href}>
                      &middot; {item.label}
                    </li>
                  ))}
                </ul>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </HydrateClient>
  );
}
