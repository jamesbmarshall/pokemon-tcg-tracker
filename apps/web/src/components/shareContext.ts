import { createContext, useContext } from 'react';

/** Set on public share pages, where links into the signed-in app would lead nowhere. */
export const PublicShareContext = createContext<{ token: string } | null>(null);

export const usePublicShare = () => useContext(PublicShareContext);
