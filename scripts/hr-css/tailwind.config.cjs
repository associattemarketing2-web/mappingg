// Tailwind config for the HR & Attendance module (app/dashboard/hr).
// Mappingg itself does not use Tailwind, so the HR stylesheet is compiled ahead of
// time into app/dashboard/hr/hr.css (committed). Rebuild after changing HR markup:
//   node scripts/hr-css/build.mjs
// Everything is scoped under the .ems wrapper so it can never touch Mappingg pages:
// utilities are prefixed with `.ems` and Tailwind's global reset (preflight) is
// replaced by a scoped one in input.css.
const path = require('path');
const root = path.join(__dirname, '..', '..');
module.exports = {
  content: [path.join(root, 'app/dashboard/hr/**/*.{ts,tsx}'), path.join(root, 'components/hr/**/*.{ts,tsx}')],
  important: '.ems',
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eef2ff', 100: '#e0e7ff', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 900: '#312e81' },
      },
    },
  },
  plugins: [],
};
