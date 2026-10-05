/**
 * Context marking that the tree is rendering a public share page. Kept in its own module (not
 * PublicSharePage.tsx) so components can import it without breaking React Fast Refresh, which
 * needs component files to export only components.
 */
import { createContext, useContext } from 'react';

/**
 * Set on public share pages, where links into the signed-in app would lead nowhere. Components use
 * it to hide navigation and edit affordances. This is presentation only: the visitor's access is
 * limited by the share token on the server.
 */
export const PublicShareContext = createContext<{ token: string } | null>(null);

export const usePublicShare = () => useContext(PublicShareContext);
