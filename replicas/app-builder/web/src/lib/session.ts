import "server-only";

/**
 * The signed-in user. Until Supabase Auth is wired in, everything belongs to
 * one local user; this is the only function that changes when login arrives.
 */
export async function getUserId(): Promise<string> {
  return "local";
}
