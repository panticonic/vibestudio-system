/**
 * Connection-entry state atoms -- Jotai atoms for opening the account.
 *
 * The device credential is the host's; these only track whether this client
 * has an open account session and how entering it is going.
 */

import { atom } from "jotai";

/** The on-device panel-asset origin of the shown workspace. */
export const serverUrlAtom = atom<string>("");

/** Whether the account session is open and the shell is entered */
export const isAuthenticatedAtom = atom<boolean>(false);

/** Loading state for opening the account */
export const authLoadingAtom = atom<boolean>(false);

/** Why the account could not be opened (e.g., connection refused) */
export const authErrorAtom = atom<string | null>(null);
