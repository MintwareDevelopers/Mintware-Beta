// Cookie names shared by the edge middleware (coarse gate) and the Node server layer (authoritative
// verification). Kept in their own dependency-free module so the edge middleware never has to import the
// Node-only session.ts (which lazily pulls @privy-io/server-auth).

/** Privy's session access-token cookie — presence = "maybe authenticated" (verified for real server-side). */
export const PRIVY_TOKEN_COOKIE = 'privy-token'

/** Companion cookie the client writes post-login from verified metadata, so the edge middleware can do
 *  role-based routing WITHOUT a network call. Never trusted as a security boundary — the server re-derives
 *  the role from Privy directly (lib/auth/session.ts). */
export const MW_ROLE_COOKIE = 'mw_role'
