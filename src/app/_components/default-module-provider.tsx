'use client';

import { createContext, useContext } from 'react';

const DefaultModuleContext = createContext<string>(
  process.env.NEXT_PUBLIC_DEFAULT_MODULE ?? 'lucky-wheel',
);

export function DefaultModuleProvider({
  moduleId,
  children,
}: {
  moduleId: string;
  children: React.ReactNode;
}) {
  return (
    <DefaultModuleContext.Provider value={moduleId}>
      {children}
    </DefaultModuleContext.Provider>
  );
}

export function useDefaultModuleId() {
  return useContext(DefaultModuleContext);
}
