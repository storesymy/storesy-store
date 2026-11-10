/**
 * Session lifetime — the single source every consumer shares (the login-time
 * record, the sliding renewal in the Durable Object, and the cookie Max-Age),
 * so the three can never drift apart.
 *
 * Sliding: any authenticated activity inside the window pushes it out again,
 * so a session dies only after 2 hours *without* use.
 */
export const SESSION_TTL_SECONDS = 2 * 60 * 60;
