import { createContext, useContext, type ReactNode } from 'react';

interface EmbeddedContextValue {
  isEmbedded: boolean;
}

const EmbeddedContext = createContext<EmbeddedContextValue>({ isEmbedded: false });

export function EmbeddedProvider({ children, isEmbedded = false }: { children: ReactNode; isEmbedded?: boolean }) {
  return (
    <EmbeddedContext.Provider value={{ isEmbedded }}>
      {children}
    </EmbeddedContext.Provider>
  );
}

export function useEmbedded() {
  return useContext(EmbeddedContext);
}
