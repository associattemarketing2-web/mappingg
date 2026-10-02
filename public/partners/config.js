// =====================================================================
// Mappingg Intake — settings for the Next.js + MongoDB build.
// There is NO Supabase here: partners-shim.js provides a Supabase-shaped
// client that talks only to this app's own /api/partners/* endpoints.
// The two "supabase*" values below are kept non-empty only because the
// original shared/lib.js guards against a blank/placeholder URL; the shim
// ignores them entirely.
// =====================================================================
window.MAPPINGG_CONFIG = {
  environment: 'live',
  supabaseUrl: 'https://mongodb.local',
  supabaseAnonKey: 'local',

  // Where builders open their links (clean Next.js route)
  submitPageUrl: '/submit',

  // Server endpoint (edge-function equivalent) that turns short Google Maps
  // links into a map pin.
  mapsResolverFunction: 'resolve-maps-link',

  // Contact shown to builders on their page (leave WhatsApp empty to hide it)
  supportWhatsApp: '',
  supportEmail: 'associattemarketing@gmail.com',

  // Map pin picker opens on Mundhwa, Pune
  defaultMapCenter: [18.5314, 73.9270],
  defaultMapZoom: 13
};
