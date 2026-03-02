'use client';

import { createContext, useContext, useState } from 'react';

interface DefaultModuleContextValue {
  moduleId: string;
  setModuleId: (id: string) => void;
}

const DefaultModuleContext = createContext<DefaultModuleContextValue>({
  moduleId: process.env.NEXT_PUBLIC_DEFAULT_MODULE ?? 'lucky-wheel',
  setModuleId: () => {},
});

export function DefaultModuleProvider({
  moduleId: initialModuleId,
  children,
}: {
  moduleId: string;
  children: React.ReactNode;
}) {
  const [moduleId, setModuleId] = useState(initialModuleId);

  return (
    <DefaultModuleContext.Provider value={{ moduleId, setModuleId }}>
      {children}
    </DefaultModuleContext.Provider>
  );
}

export function useDefaultModuleId() {
  return useContext(DefaultModuleContext).moduleId;
}

export function useSetDefaultModuleId() {
  return useContext(DefaultModuleContext).setModuleId;
}
