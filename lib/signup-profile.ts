import { z } from 'zod';

// Sign-up fields per account type — shared by the password sign-up and the
// "complete your Google sign-up" form so both ask for and check the same things.
// Buyers only need name, mobile and email (the base fields): their preferences
// are optional and just help match projects. Developers and agents must give
// their company and MahaRERA number, which the super admin verifies.
const req = (max = 120) => z.string().trim().min(1).max(max);
const opt = (max = 120) => z.string().trim().max(max).optional().default('');
// The plan picked on the sign-up form (a sub_plans code, e.g. "dev_large"). Kept on the
// profile so staff see what the account wants; it never activates anything by itself —
// paid plans start only after checkout on /dashboard/<role>/subscription.
const plan = z.string().trim().max(40).regex(/^[a-z0-9_-]*$/).optional().default('');

export const PROFILE_SCHEMAS = {
  buyer: z.object({
    area: opt(), configuration: opt(), budget: opt(), timeline: opt(), purpose: opt(), plan,
  }).default({}),
  developer: z.object({
    company: req(160), designation: req(), activeProjects: req(),
    // Website is the one optional field (many developers don't have one).
    reraProject: z.string().trim().min(4).max(40), website: z.string().trim().max(300).optional().default(''), plan,
  }),
  agent: z.object({
    agency: req(160),
    reraAgent: z.string().trim().min(4).max(40), areas: req(300), plan,
  }),
};

/** The z.discriminatedUnion branches for `role` + `profile`, merged onto `base`. */
export function withRoleProfiles<T extends z.ZodRawShape>(base: z.ZodObject<T>) {
  return z.discriminatedUnion('role', [
    base.extend({ role: z.literal('buyer'), profile: PROFILE_SCHEMAS.buyer }),
    base.extend({ role: z.literal('developer'), profile: PROFILE_SCHEMAS.developer }),
    base.extend({ role: z.literal('agent'), profile: PROFILE_SCHEMAS.agent }),
  ]);
}
