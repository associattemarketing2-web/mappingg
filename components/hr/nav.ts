// Pages of the HR & Attendance module. The s-admin "HR & Attendance" tab shows
// them as its sub-tabs (same pill style as the rest of the super-admin) and the
// page itself in place; the owner gets the admin half, staff the employee half.
export type HrNavItem = { href: string; label: string; icon: string };

export const HR_ADMIN_NAV: HrNavItem[] = [
  { href: '/dashboard/hr/admin', label: 'Overview', icon: 'fa-gauge-high' },
  { href: '/dashboard/hr/admin/employees', label: 'Employees', icon: 'fa-users' },
  { href: '/dashboard/hr/admin/attendance', label: 'Attendance', icon: 'fa-user-clock' },
  { href: '/dashboard/hr/admin/tasks', label: 'Tasks', icon: 'fa-list-check' },
  { href: '/dashboard/hr/admin/leaves', label: 'Leaves', icon: 'fa-umbrella-beach' },
  { href: '/dashboard/hr/admin/report', label: 'Monthly sheet', icon: 'fa-calendar-days' },
  { href: '/dashboard/hr/admin/payroll', label: 'Salary & hours', icon: 'fa-indian-rupee-sign' },
  { href: '/dashboard/hr/admin/settings', label: 'Settings', icon: 'fa-gear' },
];

export const HR_EMPLOYEE_NAV: HrNavItem[] = [
  { href: '/dashboard/hr/employee', label: 'Today', icon: 'fa-house' },
  { href: '/dashboard/hr/employee/tasks', label: 'My tasks', icon: 'fa-list-check' },
  { href: '/dashboard/hr/employee/attendance', label: 'History', icon: 'fa-calendar-check' },
  { href: '/dashboard/hr/employee/leaves', label: 'Leaves', icon: 'fa-umbrella-beach' },
  { href: '/dashboard/hr/employee/profile', label: 'Profile', icon: 'fa-id-card' },
];

/** The sub-tab a path belongs to (home pages match exactly, the rest by prefix). */
export function hrActive(items: HrNavItem[], path: string): string {
  const home = items[0].href;
  return (path === home ? items[0] : items.slice(1).find((i) => path === i.href || path.startsWith(i.href + '/')))?.href || home;
}

/** Only HR paths may be opened in the tab. */
export const isHrPath = (p: string | null | undefined): p is string => !!p && /^\/dashboard\/hr(\/[\w-]+)*\/?(\?[^#]*)?$/.test(p);
