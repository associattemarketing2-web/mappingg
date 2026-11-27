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
        // Mappingg's forest green (the super-admin's --forest / --forest-deep), so HR matches it.
        brand: { 50: '#e8f2ec', 100: '#d4e9dc', 500: '#1f7a5c', 600: '#0f5c47', 700: '#0a4535', 900: '#06291f' },
      },
    },
  },
  plugins: [],
};
