// The role to use when an account record or token has none. Least privilege:
// a missing role must never grant staff access. (It used to default to 'admin';
// no account lacked a role when this changed on 20 Oct 2026, so nobody lost access.)
export const DEFAULT_ROLE = 'buyer';

export function roleOrDefault(role: unknown): string {
  return typeof role === 'string' && role.trim() ? role.trim() : DEFAULT_ROLE;
}
