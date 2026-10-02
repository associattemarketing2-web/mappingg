// TypeScript shapes for every MongoDB collection, mirroring the original
// Supabase/Postgres tables 1:1. These document the data contract used by the
// db-engine and API routes. Fields are optional/loose where the original rows
// varied, matching the schemaless reality of the exported data.

/** Real-estate project pins (collection: `pins`). */
export interface Pin {
  id: string;
  _id?: string;
  number: number;
  lat: number;
  lng: number;
  title?: string;
  type?: string; // Residential | Commercial | ...
  status?: string; // available | under_construction | upcoming | sold
  price?: string;
  description?: string;
  image?: string | null; // data: URL or image_url
  image_url?: string | null;
  configuration?: string;
  sqft?: string;
  size?: string;
  possession_timeline?: string;
  launch_date?: string;
  whats_available?: string;
  highlighted?: boolean;
  developer?: string;
  location?: string;
  key_usp?: string;
  field_visibility?: Record<string, unknown>;
  custom_fields?: unknown;
  youtube_video_url?: string;
  brochure_image?: string | null;
  brochure_url?: string | null;
  brochure_width?: number;
  brochure_height?: number;
  created_at?: string;
  updated_at?: string;
}

/** Infrastructure point markers — metro, bridges, schools, etc. (`infra_markers`). */
export interface InfraMarker {
  id: string;
  _id?: string;
  lat: number;
  lng: number;
  title?: string;
  notes?: string;
  type: string; // bridge | metro_station | school | hospital | garden | ...
  size?: string; // small | medium | large
  color?: string;
  created_at?: string;
  updated_at?: string;
}

/** Roads / metro lines / boundaries drawn as polylines (`roads`). */
export interface Road {
  id: string;
  _id?: string;
  type: string; // proposed_road | metro_line | ...
  color?: string;
  weight?: number;
  title?: string;
  notes?: string;
  points: [number, number][];
  created_at?: string;
  updated_at?: string;
}

/** Named area boundaries (`area_boundaries`). */
export interface AreaBoundary {
  id: string;
  _id?: string;
  name?: string;
  points?: [number, number][];
  color?: string;
  created_at?: string;
  updated_at?: string;
}

/** Custom infrastructure type definitions added by the team (`infra_types`). */
export interface InfraType {
  id: string;
  _id?: string;
  key: string;
  label: string;
  emoji?: string;
  color?: string;
  created_at?: string;
}

/** Single-row map/site settings (`map_settings`, id === 1). */
export interface MapSettings {
  id: number;
  _id?: string;
  gtm_container_id?: string;
  search_console_verification?: string;
  youtube_video_url?: string;
  boundary?: [number, number][];
  [key: string]: unknown;
}

/** Captured lead submissions (`leads`) — PRIVATE, auth required to read. */
export interface Lead {
  id: string;
  _id?: string;
  pin_id: string;
  role?: string;
  name?: string;
  whatsapp?: string;
  email?: string;
  consent?: boolean;
  created_at?: string;
}

/** Pin edit/delete snapshots (`pins_history`) — PRIVATE, auth required. */
export interface PinHistory {
  history_id: string;
  _id?: string;
  pin_id: string;
  operation: 'update' | 'delete';
  row_data: Pin;
  changed_at: string;
}

/** Admin/team accounts (`users`) — replaces Supabase Auth. */
export interface User {
  id: string;
  _id?: string;
  email: string;
  password_hash: string;
  role: string; // 'admin'
  created_at?: string;
}

// ---------------------------------------------------------------------------
// Partners intake (bulk CSV upload → review queue → publish). Backed by the
// same MongoDB database; see lib/partners-engine.ts for the behaviour.
// ---------------------------------------------------------------------------

/** A developer/channel partner who submits projects (`builders`). */
export interface Builder {
  id: string;
  _id?: string;
  code: string; // auto-generated, e.g. GODR-001
  company_name: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  city?: string;
  country?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

/** A unique, shareable link a builder uses to submit projects (`submission_links`). */
export interface SubmissionLink {
  id: string;
  _id?: string;
  builder_id: string;
  token: string; // secret, used in /submit?t=
  tag: string; // human label, e.g. LNK-0001
  label?: string | null;
  is_active: boolean;
  expires_at?: string | null;
  open_count?: number;
  first_opened_at?: string | null;
  last_opened_at?: string | null;
  last_activity_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** A project submitted for review (`project_submissions`). Loose by design — it
 *  mirrors the field set in public/partners/shared/fields.js. */
export interface ProjectSubmission {
  id: string;
  _id?: string;
  ref_code: string; // auto-generated, e.g. MAP-SUB-00001
  status: 'draft' | 'submitted' | 'in_review' | 'changes_requested' | 'published' | 'rejected';
  source: 'link' | 'excel' | 'csv' | 'admin';
  builder_id?: string | null;
  link_id?: string | null;
  project_name?: string;
  flags?: Record<string, { note: string; at?: string }>;
  previous_flags?: Record<string, { note: string; at?: string }>;
  has_unpublished_changes?: boolean;
  published_project_id?: string | null;
  submitted_at?: string | null;
  published_at?: string | null;
  import_batch_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

/** Audit-trail entry for a submission (`submission_events`). */
export interface SubmissionEvent {
  id: string;
  _id?: string;
  submission_id: string;
  action: string; // created | status_changed | changes_requested | published | ...
  actor: 'admin' | 'builder' | 'system';
  details?: Record<string, unknown>;
  created_at?: string;
}

/** A published, live-on-the-map project derived from a submission (`projects`). */
export interface Project {
  id: string;
  _id?: string;
  submission_id: string;
  slug: string;
  is_live: boolean;
  featured?: boolean;
  project_name?: string;
  price_label?: string;
  cover_image_url?: string | null;
  published_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export const COLLECTIONS = [
  'pins',
  'infra_markers',
  'roads',
  'area_boundaries',
  'infra_types',
  'map_settings',
  'leads',
  'pins_history',
  'users',
  // Partners intake
  'builders',
  'submission_links',
  'project_submissions',
  'submission_events',
  'projects',
  'counters',
] as const;
