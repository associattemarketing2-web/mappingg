// Subscription catalogue: the feature keys the entitlement engine understands,
// and the DEFAULT plans seeded into the database the first time the tables are
// created. After seeding, the database is the source of truth — admins change
// prices, billing cycles, features and limits in Super admin → Subscriptions,
// and nothing in the app reads these defaults again (no hard-coded prices).

export const CATEGORIES = ['developer', 'cp', 'buyer'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  developer: 'Developer',
  cp: 'Channel Partner',
  buyer: 'Buyer',
};

/** Account role (users.role) → subscription category. Staff have none. */
export function categoryForRole(role?: string | null): Category | null {
  if (role === 'developer') return 'developer';
  if (role === 'agent') return 'cp';
  if (role === 'buyer') return 'buyer';
  return null;
}

export const SUB_STATUSES = ['FREE', 'PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'FAILED', 'PAST_DUE', 'REFUNDED', 'SUSPENDED'] as const;
export type SubStatus = (typeof SUB_STATUSES)[number];
/** Statuses that still grant the plan's paid entitlements. */
export const ENTITLED_STATUSES: readonly SubStatus[] = ['ACTIVE', 'PAST_DUE'];
/** Statuses that occupy the user's single "current" slot for a category. */
export const OPEN_STATUSES: readonly SubStatus[] = ['ACTIVE', 'PAST_DUE', 'PENDING'];

export const BILLING_PERIODS = ['none', 'month', 'quarter', 'half_year', 'year'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];
export const PERIOD_MONTHS: Record<BillingPeriod, number> = { none: 0, month: 1, quarter: 3, half_year: 6, year: 12 };
export const PERIOD_LABEL: Record<BillingPeriod, string> = { none: 'Free forever', month: 'per month', quarter: 'per quarter (3 months)', half_year: 'per 6 months', year: 'per year' };

export const BILLING_UNITS = ['account', 'project'] as const;
export type BillingUnit = (typeof BILLING_UNITS)[number];

export const USAGE_PERIODS = ['week', 'month', 'lifetime'] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

export interface FeatureDef {
  key: string;
  category: Category;
  label: string;
  /** flag = on/off; limit = a number (null = unlimited) stored in plan.limits. */
  kind: 'flag' | 'limit';
  description?: string;
}

// ---- feature catalogue --------------------------------------------------------
// Flags are stored in plan.features (key → true/false), limits in plan.limits
// (key → number | null). Unknown keys are ignored, missing flags are "off" and
// missing limits are "0" (least privilege).
export const FEATURES: FeatureDef[] = [
  // Developer
  { key: 'dev_project_listing', category: 'developer', kind: 'flag', label: 'Project listing' },
  { key: 'dev_basic_details', category: 'developer', kind: 'flag', label: 'Basic project details' },
  { key: 'dev_rera_details', category: 'developer', kind: 'flag', label: 'RERA configuration / details' },
  { key: 'dev_area_price_units', category: 'developer', kind: 'flag', label: 'Area (sq ft), price range & number of units' },
  { key: 'dev_basic_visibility', category: 'developer', kind: 'flag', label: 'Basic project visibility' },
  { key: 'dev_basic_dashboard', category: 'developer', kind: 'flag', label: 'Basic developer dashboard' },
  { key: 'dev_advanced_dashboard', category: 'developer', kind: 'flag', label: 'Advanced dashboard' },
  { key: 'dev_brochure_upload', category: 'developer', kind: 'flag', label: 'Project brochure upload' },
  { key: 'dev_floor_plan_upload', category: 'developer', kind: 'flag', label: 'Floor plan upload' },
  { key: 'dev_gallery_upload', category: 'developer', kind: 'flag', label: 'Project gallery' },
  { key: 'dev_project_editing', category: 'developer', kind: 'flag', label: 'Edit live projects', description: 'Free accounts can still correct projects that are pending or not approved.' },
  { key: 'dev_rera_verification_info', category: 'developer', kind: 'flag', label: 'RERA verification status & supporting info', description: 'Shows the verification status Mappingg recorded — buying a plan never marks a project verified.' },
  { key: 'dev_igbc_info', category: 'developer', kind: 'flag', label: 'IGBC / green certification information' },
  { key: 'dev_advanced_management', category: 'developer', kind: 'flag', label: 'Advanced project management' },
  { key: 'dev_site_visit_booking', category: 'developer', kind: 'flag', label: 'Book site visit on your projects' },
  { key: 'dev_enhanced_visibility', category: 'developer', kind: 'flag', label: 'Better visibility & enhanced promotion' },
  { key: 'dev_enhanced_presentation', category: 'developer', kind: 'flag', label: 'Advanced project presentation' },
  { key: 'dev_bulk_listing', category: 'developer', kind: 'flag', label: 'Bulk project listing (Excel / CSV)' },
  { key: 'dev_video_highlight', category: 'developer', kind: 'flag', label: 'Highlighted project videos' },
  { key: 'dev_multi_state', category: 'developer', kind: 'flag', label: 'Visibility across multiple states' },
  { key: 'dev_priority_promotion', category: 'developer', kind: 'flag', label: 'Priority project promotion' },
  { key: 'dev_max_projects', category: 'developer', kind: 'limit', label: 'Projects you can list', description: 'Total projects on your account (blank = unlimited).' },
  { key: 'dev_max_states', category: 'developer', kind: 'limit', label: 'States your subscribed projects can span' },
  { key: 'dev_media_per_project', category: 'developer', kind: 'limit', label: 'Media files per project' },

  // Channel partner
  { key: 'cp_project_access', category: 'cp', kind: 'flag', label: 'Project detail access' },
  { key: 'cp_weekly_project_access', category: 'cp', kind: 'limit', label: 'Unique project details per week' },
  { key: 'cp_max_cities', category: 'cp', kind: 'limit', label: 'Cities you can access (blank = all)' },
  { key: 'cp_basic_info', category: 'cp', kind: 'flag', label: 'Basic browsing & property information' },
  { key: 'cp_dashboard', category: 'cp', kind: 'flag', label: 'Account dashboard' },
  { key: 'cp_enhanced_info', category: 'cp', kind: 'flag', label: 'Enhanced project information' },
  { key: 'cp_brochure_access', category: 'cp', kind: 'flag', label: 'Brochure download' },
  { key: 'cp_floor_plan_access', category: 'cp', kind: 'flag', label: 'Floor plan access' },
  { key: 'cp_leads', category: 'cp', kind: 'flag', label: 'Add & track your client leads' },
  { key: 'cp_max_leads', category: 'cp', kind: 'limit', label: 'Client leads you can keep' },
  { key: 'cp_crm', category: 'cp', kind: 'flag', label: 'Integrated CRM (pipeline, follow-ups, export)' },
  { key: 'cp_lead_visibility', category: 'cp', kind: 'flag', label: 'Lead visibility & activity history' },
  { key: 'cp_future_price', category: 'cp', kind: 'flag', label: 'Future price information' },
  { key: 'cp_all_listings', category: 'cp', kind: 'flag', label: 'All eligible map listings' },
  { key: 'cp_advanced_dashboard', category: 'cp', kind: 'flag', label: 'Advanced CP dashboard' },

  // Buyer
  { key: 'buyer_listing_access', category: 'buyer', kind: 'flag', label: 'Property listing access' },
  { key: 'buyer_listing_limit', category: 'buyer', kind: 'limit', label: 'Property listings you can open' },
  { key: 'buyer_compare', category: 'buyer', kind: 'flag', label: 'Compare properties' },
  { key: 'buyer_favourites', category: 'buyer', kind: 'flag', label: 'Favourite properties' },
  { key: 'buyer_share', category: 'buyer', kind: 'flag', label: 'Share property listings' },
  { key: 'buyer_loan_tools', category: 'buyer', kind: 'flag', label: 'Home-loan EMI & eligibility calculator' },
  { key: 'buyer_vastu', category: 'buyer', kind: 'flag', label: 'Vastu guidance' },
  { key: 'buyer_legal_info', category: 'buyer', kind: 'flag', label: 'Legal information & document checklist' },
  { key: 'buyer_expert_assist', category: 'buyer', kind: 'flag', label: 'Property expert assistance' },
  { key: 'buyer_portfolio', category: 'buyer', kind: 'flag', label: 'Portfolio manager' },
  { key: 'buyer_premium_insights', category: 'buyer', kind: 'flag', label: 'Premium property insights' },
];

export const FEATURE_BY_KEY = new Map(FEATURES.map((f) => [f.key, f]));

/** Which usage counter each metered limit uses, and over what period by default. */
export const METERS: Record<string, { limit: string; period: UsagePeriod; label: string }> = {
  project_access: { limit: 'cp_weekly_project_access', period: 'week', label: 'Project details opened this week' },
  listing_access: { limit: 'buyer_listing_limit', period: 'lifetime', label: 'Property listings opened' },
};

export interface PlanSeed {
  category: Category;
  code: string;
  name: string;
  tagline: string;
  price_paise: number;
  billing_period: BillingPeriod;
  billing_unit: BillingUnit;
  recommended?: boolean;
  sort: number;
  features: Record<string, boolean>;
  limits: Record<string, number | null>;
  /** Override for metered limits' reset period, e.g. { buyer_listing_limit: 'lifetime' }. */
  limit_periods?: Record<string, UsagePeriod>;
}

const on = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, true]));

const DEV_FREE = ['dev_project_listing', 'dev_basic_details', 'dev_rera_details', 'dev_area_price_units', 'dev_basic_visibility', 'dev_basic_dashboard'];
const DEV_MEDIUM = [...DEV_FREE, 'dev_advanced_dashboard', 'dev_brochure_upload', 'dev_floor_plan_upload', 'dev_gallery_upload', 'dev_project_editing', 'dev_rera_verification_info', 'dev_igbc_info', 'dev_advanced_management'];
const DEV_LARGE = [...DEV_MEDIUM, 'dev_site_visit_booking', 'dev_enhanced_visibility', 'dev_enhanced_presentation'];
const DEV_BULK = [...DEV_LARGE, 'dev_bulk_listing', 'dev_video_highlight', 'dev_multi_state', 'dev_priority_promotion'];

const CP_FREE = ['cp_project_access', 'cp_basic_info', 'cp_dashboard'];
const CP_PRO = [...CP_FREE, 'cp_enhanced_info', 'cp_brochure_access', 'cp_floor_plan_access', 'cp_leads'];
const CP_PROMAX = [...CP_PRO, 'cp_crm', 'cp_lead_visibility', 'cp_future_price', 'cp_all_listings', 'cp_advanced_dashboard'];

const BUYER_FREE = ['buyer_listing_access', 'buyer_compare', 'buyer_favourites', 'buyer_share', 'buyer_loan_tools'];
const BUYER_PREMIUM = [...BUYER_FREE, 'buyer_vastu', 'buyer_legal_info', 'buyer_expert_assist', 'buyer_portfolio', 'buyer_premium_insights'];

/** Seeded once. Prices in paise (₹1 = 100 paise). */
export const DEFAULT_PLANS: PlanSeed[] = [
  { category: 'developer', code: 'dev_free', name: 'Free — Small', tagline: 'List your projects with the essentials', price_paise: 0, billing_period: 'none', billing_unit: 'account', sort: 1,
    features: on(...DEV_FREE), limits: { dev_max_projects: 3, dev_max_states: 1, dev_media_per_project: 0 } },
  { category: 'developer', code: 'dev_medium', name: 'Medium', tagline: 'Brochures, floor plans, gallery & advanced dashboard', price_paise: 100_000, billing_period: 'month', billing_unit: 'project', sort: 2,
    features: on(...DEV_MEDIUM), limits: { dev_max_projects: null, dev_max_states: 1, dev_media_per_project: 30 } },
  { category: 'developer', code: 'dev_large', name: 'Large', tagline: 'Site-visit booking and better visibility', price_paise: 150_000, billing_period: 'month', billing_unit: 'project', recommended: true, sort: 3,
    features: on(...DEV_LARGE), limits: { dev_max_projects: null, dev_max_states: 1, dev_media_per_project: 60 } },
  { category: 'developer', code: 'dev_bulk', name: 'Large Bulk', tagline: 'Bulk listing, videos & multi-state priority promotion', price_paise: 200_000, billing_period: 'month', billing_unit: 'project', sort: 4,
    features: on(...DEV_BULK), limits: { dev_max_projects: null, dev_max_states: null, dev_media_per_project: 100 } },

  { category: 'cp', code: 'cp_free', name: 'Free', tagline: 'Browse projects — 3 project details a week', price_paise: 0, billing_period: 'none', billing_unit: 'account', sort: 1,
    features: on(...CP_FREE), limits: { cp_weekly_project_access: 3, cp_max_cities: null, cp_max_leads: 0 } },
  { category: 'cp', code: 'cp_pro', name: 'Pro', tagline: '10 projects a week in your city, brochures & leads', price_paise: 100_000, billing_period: 'month', billing_unit: 'account', recommended: true, sort: 2,
    features: on(...CP_PRO), limits: { cp_weekly_project_access: 10, cp_max_cities: 1, cp_max_leads: 50 } },
  { category: 'cp', code: 'cp_promax', name: 'Pro Max', tagline: 'Unlimited access, future prices & full CRM', price_paise: 200_000, billing_period: 'month', billing_unit: 'account', sort: 3,
    features: on(...CP_PROMAX), limits: { cp_weekly_project_access: null, cp_max_cities: null, cp_max_leads: null } },

  { category: 'buyer', code: 'buyer_free', name: 'Free', tagline: 'Open 20 listings, compare, save & share', price_paise: 0, billing_period: 'none', billing_unit: 'account', sort: 1,
    features: on(...BUYER_FREE), limits: { buyer_listing_limit: 20 }, limit_periods: { buyer_listing_limit: 'lifetime' } },
  { category: 'buyer', code: 'buyer_premium', name: 'Buyer Premium', tagline: 'Vastu, legal info, expert help & portfolio manager', price_paise: 199_900, billing_period: 'quarter', billing_unit: 'account', recommended: true, sort: 2,
    features: on(...BUYER_PREMIUM), limits: { buyer_listing_limit: null }, limit_periods: { buyer_listing_limit: 'lifetime' } },
];

/** Default plan code per category — what every account is on without a paid plan. */
export const FREE_PLAN_CODE: Record<Category, string> = { developer: 'dev_free', cp: 'cp_free', buyer: 'buyer_free' };

export const formatInr = (paise: number) =>
  `₹${(Math.round(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
