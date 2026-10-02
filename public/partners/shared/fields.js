// =====================================================================
// Single source of truth for every project field.
// The builder form, admin review form, Excel importer, completeness
// score and validation all read from this file. Add a field here (and a
// column in the database) and it appears everywhere.
// =====================================================================

export const OPTIONS = {
  project_type: ['Residential', 'Commercial', 'Mixed-Use', 'Plotted Development', 'Land Parcel'],
  construction_status: ['Upcoming', 'New Launch', 'Under Construction', 'Ready to Move'],
  sales_status: ['Available', 'Few Units Left', 'Sold Out'],
  country: ['India', 'United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Oman', 'United Kingdom', 'United States', 'Singapore', 'Other'],
  currency: ['INR', 'AED', 'USD', 'GBP', 'EUR', 'SAR', 'QAR', 'OMR', 'SGD'],
  price_unit: ['Lakh', 'Crore', 'Thousand', 'Million'],
  configurations: ['Studio', '1 BHK', '1.5 BHK', '2 BHK', '2.5 BHK', '3 BHK', '3.5 BHK', '4 BHK', '5+ BHK',
    'Villa', 'Row House', 'Penthouse', 'Duplex', 'Plot', 'Shop', 'Office', 'Showroom', 'Co-working', 'Warehouse', 'Land'],
  area_unit: ['sq ft', 'sq m', 'sq yd'],
  green_certification: ['None', 'IGBC', 'GRIHA', 'LEED', 'EDGE', 'Estidama', 'Other'],
  green_rating: ['Certified', 'Silver', 'Gold', 'Platinum', '1 Star', '2 Star', '3 Star', '4 Star', '5 Star', 'Pre-certified'],
  amenities: ['Clubhouse', 'Swimming Pool', 'Gym', 'Kids Play Area', 'Jogging Track', 'Landscaped Garden',
    'Indoor Games', 'Multipurpose Hall', 'Co-working Space', 'Sports Court', 'Yoga Deck', 'Senior Citizen Area',
    'Pet Park', 'Amphitheatre', 'Party Lawn', 'Library', 'Mini Theatre', 'Spa / Sauna', 'Retail / Shops',
    '24x7 Security', 'CCTV', 'Power Backup', 'EV Charging', 'Rainwater Harvesting', 'Solar Power',
    'Sewage Treatment Plant', 'Visitor Parking', 'Covered Parking', 'Lifts', 'Fire Safety']
};

// type: text | textarea | select | multiselect | number | month | url | date | checkbox | tags | pin | file | files | kv
// audience: builder (in Excel + link form) | admin (review form only)
// required: needed before a builder can submit
// publish: needed before an admin can publish (mirrors publish_blockers() in SQL)
// score: counts toward the completeness score
export const FIELDS = [
  // ----- Builder: Project basics -----
  { key: 'project_name', label: 'Project name', type: 'text', audience: 'builder', group: 'basics', required: true, publish: true, score: true,
    excel: 'Project Name', aliases: ['project', 'name', 'project title', 'title'] },
  { key: 'project_type', label: 'Project type', type: 'select', options: 'project_type', audience: 'builder', group: 'basics', required: true, publish: true, score: true,
    excel: 'Project Type', aliases: ['type', 'property type'] },
  { key: 'construction_status', label: 'Construction status', type: 'select', options: 'construction_status', audience: 'builder', group: 'basics', score: true,
    excel: 'Construction Status', aliases: ['status', 'project status'] },
  { key: 'sales_status', label: 'Sales status', type: 'select', options: 'sales_status', audience: 'builder', group: 'basics', score: true,
    excel: 'Sales Status', aliases: ['availability', 'inventory status'] },
  { key: 'developer_name', label: 'Developer name', type: 'text', audience: 'builder', group: 'basics', required: true, score: true,
    excel: 'Developer Name', aliases: ['developer', 'builder', 'builder name', 'developer / builder'] },

  // ----- Builder: Location -----
  { key: 'country', label: 'Country', type: 'select', options: 'country', audience: 'builder', group: 'location', required: true, publish: true, score: true,
    excel: 'Country', aliases: [] },
  { key: 'state', label: 'State / Emirate', type: 'text', audience: 'builder', group: 'location', score: true,
    excel: 'State', aliases: ['state / emirate', 'emirate', 'region'] },
  { key: 'city', label: 'City', type: 'text', audience: 'builder', group: 'location', required: true, publish: true, score: true,
    excel: 'City', aliases: ['town'] },
  { key: 'locality', label: 'Locality / Area', type: 'text', audience: 'builder', group: 'location', score: true,
    excel: 'Locality / Area', aliases: ['locality', 'area', 'location', 'micro market', 'neighbourhood', 'neighborhood'] },
  { key: 'address', label: 'Full address', type: 'textarea', audience: 'builder', group: 'location',
    excel: 'Full Address', aliases: ['address', 'site address'] },
  { key: 'google_maps_link', label: 'Google Maps link', type: 'url', audience: 'builder', group: 'location', score: true,
    help: 'Open the project on Google Maps → Share → Copy link, then paste it here.',
    excel: 'Google Maps Link', aliases: ['map link', 'google map link', 'maps link', 'location link', 'google location'] },
  { key: 'pin', label: 'Map pin', type: 'pin', audience: 'builder', group: 'location', publish: true, score: true,
    help: 'Filled automatically from the Google Maps link when possible. You can also tap the map to place the pin.' },

  // ----- Builder: Price & configuration -----
  { key: 'currency', label: 'Currency', type: 'select', options: 'currency', audience: 'builder', group: 'price',
    excel: 'Currency', aliases: [] },
  { key: 'price_min', label: 'Starting price', type: 'number', audience: 'builder', group: 'price', score: true,
    excel: 'Price Min', aliases: ['min price', 'starting price', 'price from', 'price / budget', 'price', 'budget'] },
  { key: 'price_max', label: 'Highest price', type: 'number', audience: 'builder', group: 'price',
    excel: 'Price Max', aliases: ['max price', 'price to', 'upto price'] },
  { key: 'price_unit', label: 'Price unit', type: 'select', options: 'price_unit', audience: 'builder', group: 'price',
    excel: 'Price Unit', aliases: ['unit'] },
  { key: 'price_on_request', label: 'Price on request', type: 'checkbox', audience: 'builder', group: 'price',
    excel: 'Price on Request (Yes/No)', aliases: ['price on request', 'on request'] },
  { key: 'configurations', label: 'Configuration', type: 'multiselect', options: 'configurations', audience: 'builder', group: 'price', score: true,
    excel: 'Configuration', aliases: ['configurations', 'bhk', 'unit types', 'typology'] },
  { key: 'area_unit', label: 'Area unit', type: 'select', options: 'area_unit', audience: 'builder', group: 'price',
    excel: 'Area Unit', aliases: [] },
  { key: 'carpet_area_min', label: 'Carpet area — smallest', type: 'number', audience: 'builder', group: 'price', score: true,
    excel: 'Carpet Area Min', aliases: ['sq ft range', 'sqft', 'carpet area', 'area min', 'size'] },
  { key: 'carpet_area_max', label: 'Carpet area — largest', type: 'number', audience: 'builder', group: 'price',
    excel: 'Carpet Area Max', aliases: ['area max'] },

  // ----- Builder: Timeline & registration -----
  { key: 'launch_date', label: 'Launch date', type: 'month', audience: 'builder', group: 'timeline', score: true,
    excel: 'Launch Date (MMM-YYYY)', aliases: ['launch date', 'approximate launch date', 'launch'] },
  { key: 'possession_date_rera', label: 'Possession date as per RERA', type: 'month', audience: 'builder', group: 'timeline', score: true,
    excel: 'RERA Possession Date (MMM-YYYY)', aliases: ['rera possession', 'rera possession date', 'possession date'] },
  { key: 'possession_date_target', label: 'Target possession date', type: 'month', audience: 'builder', group: 'timeline',
    excel: 'Target Possession Date (MMM-YYYY)', aliases: ['target possession', 'possession timeline', 'expected possession'] },
  { key: 'rera_numbers', label: 'RERA / Registration number(s)', type: 'tags', audience: 'builder', group: 'timeline', publish: 'india', score: true,
    help: 'Add one number per phase. For Dubai, add the DLD / Trakheesi permit number.',
    excel: 'RERA / Registration Number(s)', aliases: ['rera number', 'rera', 'rera no', 'registration number', 'permit number', 'rera numbers'] },

  // ----- Builder: Highlights & media -----
  { key: 'key_usps', label: 'Key USPs', type: 'textarea', audience: 'builder', group: 'media', score: true, maxLines: 3,
    help: 'Up to 3 short points, one per line. Facts only, e.g. "5 min from Pune Airport".',
    excel: 'Key USPs (one per line, max 3)', aliases: ['key usp', 'usp', 'usps', 'highlights'] },
  { key: 'youtube_url', label: 'YouTube video link', type: 'url', audience: 'builder', group: 'media', score: true,
    excel: 'YouTube Video Link', aliases: ['video link', 'video link (youtube)', 'youtube', 'video'] },
  { key: 'cover_image_path', label: 'Cover image', type: 'file', accept: 'image/*', audience: 'builder', group: 'media', score: true,
    help: 'Best shown landscape, at least 1200 px wide. JPG, PNG or WebP.' },
  { key: 'gallery_paths', label: 'Gallery images (up to 10)', type: 'files', accept: 'image/*', max: 10, audience: 'builder', group: 'media', score: true },
  { key: 'brochure_path', label: 'Brochure (PDF)', type: 'file', accept: 'application/pdf', audience: 'builder', group: 'media', score: true },
  { key: 'rera_qr_path', label: 'RERA QR code', type: 'file', accept: 'image/*', audience: 'builder', group: 'media', score: true },
  { key: 'media_folder_link', label: 'Media folder link', type: 'url', audience: 'builder', group: 'media',
    help: 'Optional. A Google Drive or Dropbox folder with more images, floor plans or brochures.',
    excel: 'Media Folder Link (Drive / Dropbox)', aliases: ['media folder', 'drive link', 'project brochure image', 'brochure', 'images link'] },

  // ----- Builder: Anything else -----
  { key: 'additional_details', label: 'Additional details', type: 'kv', audience: 'builder', group: 'extra',
    help: 'Anything not covered above, e.g. "Clubhouse size: 30,000 sq ft".' },
  { key: 'builder_remarks', label: 'Note for the Mappingg team', type: 'textarea', audience: 'builder', group: 'extra',
    excel: 'Remarks', aliases: ['remarks', 'notes', 'comments'] },

  // ----- Admin: Content & SEO -----
  { key: 'short_description', label: 'Short description', type: 'textarea', audience: 'admin', group: 'content', score: true,
    help: '2–3 lines for the map card and SEO page. Plain facts, no hype.' },
  { key: 'slug', label: 'Page URL slug', type: 'text', audience: 'admin', group: 'content',
    help: 'Leave blank to create one from the project name and city.' },

  // ----- Admin: Project size -----
  { key: 'land_area_acres', label: 'Land area (acres)', type: 'number', audience: 'admin', group: 'size', score: true },
  { key: 'towers', label: 'Towers', type: 'number', audience: 'admin', group: 'size', score: true },
  { key: 'floors', label: 'Floors', type: 'number', audience: 'admin', group: 'size' },
  { key: 'total_units', label: 'Total units', type: 'number', audience: 'admin', group: 'size', score: true },

  // ----- Admin: Amenities & green -----
  { key: 'amenities', label: 'Amenities', type: 'multiselect', options: 'amenities', audience: 'admin', group: 'amenities', score: true },
  { key: 'green_certification', label: 'Green certification', type: 'select', options: 'green_certification', audience: 'admin', group: 'amenities', score: true },
  { key: 'green_rating', label: 'Green rating level', type: 'select', options: 'green_rating', audience: 'admin', group: 'amenities' },

  // ----- Admin: Sales contact -----
  { key: 'sales_contact_name', label: 'Sales contact name', type: 'text', audience: 'admin', group: 'contact', score: true },
  { key: 'sales_contact_phone', label: 'Sales contact phone', type: 'text', audience: 'admin', group: 'contact', score: true },

  // ----- Admin: Verification & publishing -----
  { key: 'rera_verified_on', label: 'RERA verified on', type: 'date', audience: 'admin', group: 'verify', score: true },
  { key: 'featured', label: 'Featured project', type: 'checkbox', audience: 'admin', group: 'verify' },
  { key: 'compliance_override', label: 'Publish without RERA number (compliance checked)', type: 'checkbox', audience: 'admin', group: 'verify',
    help: 'Only tick after confirming this project can legally be shown. This is recorded in the log.' },
  { key: 'reviewer_notes', label: 'Internal notes', type: 'textarea', audience: 'admin', group: 'verify' }
];

export const GROUPS = {
  basics: { title: 'Project basics', audience: 'builder' },
  location: { title: 'Location', audience: 'builder' },
  price: { title: 'Price & configuration', audience: 'builder' },
  timeline: { title: 'Timeline & registration', audience: 'builder' },
  media: { title: 'Highlights & media', audience: 'builder' },
  extra: { title: 'Anything else', audience: 'builder' },
  content: { title: 'Content & SEO', audience: 'admin' },
  size: { title: 'Project size', audience: 'admin' },
  amenities: { title: 'Amenities & green certification', audience: 'admin' },
  contact: { title: 'Sales contact', audience: 'admin' },
  verify: { title: 'Verification & publishing', audience: 'admin' }
};

export const STATUS = {
  draft: { label: 'Draft', tone: 'muted' },
  submitted: { label: 'Submitted', tone: 'info' },
  in_review: { label: 'In review', tone: 'info' },
  changes_requested: { label: 'Changes requested', tone: 'warn' },
  published: { label: 'Published', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'bad' }
};

// Builder-visible status wording
export const BUILDER_STATUS = {
  draft: 'Draft — not sent yet',
  submitted: 'Sent — waiting for review',
  in_review: 'Being reviewed',
  changes_requested: 'Changes needed',
  published: 'Live on Mappingg',
  rejected: 'Not accepted'
};

export const fieldByKey = Object.fromEntries(FIELDS.map(f => [f.key, f]));
export const optionsFor = f => (typeof f.options === 'string' ? OPTIONS[f.options] : f.options) || [];

function isFilled(sub, f) {
  if (f.type === 'pin') return sub.lat != null && sub.lng != null;
  const v = sub[f.key];
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'boolean') return v;
  return v !== null && v !== undefined && String(v).trim() !== '';
}

// Completeness score: share of "score" fields that are filled
export function completeness(sub) {
  const scored = FIELDS.filter(f => f.score);
  const missing = scored.filter(f => !isFilled(sub, f));
  return { pct: Math.round(((scored.length - missing.length) / scored.length) * 100), missing: missing.map(f => f.label) };
}

// Mirrors publish_blockers() in the database
export function publishBlockers(sub) {
  const m = [];
  if (!sub.project_name) m.push('Project name');
  if (!sub.project_type) m.push('Project type');
  if (!sub.country) m.push('Country');
  if (!sub.city) m.push('City');
  if (sub.lat == null || sub.lng == null) m.push('Map pin');
  if (['Residential', 'Commercial', 'Mixed-Use'].includes(sub.project_type) && !(sub.configurations || []).length) m.push('Configuration');
  if (!sub.price_on_request && sub.price_min == null && sub.price_max == null) m.push('Price (or Price on request)');
  if (sub.country === 'India' && !(sub.rera_numbers || []).length && !sub.compliance_override) m.push('RERA number (required in India)');
  return m;
}

// Fields a builder must fill before pressing Submit (mirrors link_save_submission)
export function submitBlockers(d) {
  const m = [];
  if (!d.project_name) m.push('Project name');
  if (!d.project_type) m.push('Project type');
  if (!d.developer_name) m.push('Developer name');
  if (!d.country) m.push('Country');
  if (!d.city) m.push('City');
  if (!d.google_maps_link && (d.lat == null || d.lat === '' || d.lng == null || d.lng === '')) m.push('Location (Google Maps link or map pin)');
  if (!d.declaration_accepted) m.push('Declaration');
  return m;
}

export const BUILDER_FIELDS = FIELDS.filter(f => f.audience === 'builder');
export const ADMIN_FIELDS = FIELDS.filter(f => f.audience === 'admin');
export const EXCEL_FIELDS = FIELDS.filter(f => f.excel);
