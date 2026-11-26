// Row types of the HR database (same tables the standalone EMS app created).

export type Role = 'ADMIN' | 'EMPLOYEE';
export type SalaryType = 'MONTHLY' | 'HOURLY';

export interface User {
  id: string;
  empCode: string;
  name: string;
  email: string;
  password: string;
  role: Role;
  phone: string | null;
  designation: string | null;
  department: string | null;
  salaryType: SalaryType;
  salary: number;
  joinDate: Date;
  active: boolean;
  createdAt: Date;
}

export interface Settings {
  id: number;
  companyName: string;
  officeStart: string;
  officeEnd: string;
  graceMinutes: number;
  halfDayHours: number;
  workingDays: string;
  officeLat: number | null;
  officeLng: number | null;
  geofenceRadius: number;
  enforceGeofence: boolean;
  requireSelfie: boolean;
  payrollMode: string;
  casualLeavePerYear: number;
  sickLeavePerYear: number;
  paidLeavePerYear: number;
}

export interface Attendance {
  id: string;
  userId: string;
  date: string;
  checkIn: Date;
  checkOut: Date | null;
  checkInSelfie: string | null;
  checkOutSelfie: string | null;
  checkInLat: number | null;
  checkInLng: number | null;
  checkInAddress: string | null;
  checkInDistance: number | null;
  checkOutLat: number | null;
  checkOutLng: number | null;
  checkOutAddress: string | null;
  isLate: boolean;
  lateMinutes: number;
  todayPlan: string | null;
  workSummary: string | null;
  adminNote: string | null;
  createdAt: Date;
}

export interface Leave {
  id: string;
  userId: string;
  fromDate: string;
  toDate: string;
  type: string;
  reason: string | null;
  status: string;
  adminNote: string | null;
  createdAt: Date;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
}

export interface Adjustment {
  id: string;
  userId: string;
  month: string;
  type: string;
  amount: number;
  note: string | null;
  createdAt: Date;
}
