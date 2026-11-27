import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePayroll, professionalTax } from '../lib/hr/payroll';
import type { Settings } from '../lib/hr/types';

const settings = {
  officeStart: '09:30', officeEnd: '18:30', halfDayHours: 4, workingDays: '1,2,3,4,5,6', payrollMode: 'DAYS',
} as Settings;
const user = {
  id: 'u1', name: 'Test', empCode: 'EMP001', salary: 26_000, salaryType: 'MONTHLY' as const, joinDate: new Date('2025-01-01T00:00:00Z'),
  designation: null, department: null, email: 't@example.com', bankName: 'AU Small Finance Bank', bankAccount: '123',
};
// A past month so every working day has elapsed: June 2026 has 26 Mon–Sat days.
const month = '2026-06';
const days = Array.from({ length: 30 }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
  .filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() !== 0);
const present = (d: string) => ({ date: d, checkIn: new Date(`${d}T04:00:00Z`), checkOut: new Date(`${d}T13:00:00Z`), isLate: false });

test('professional tax follows the Maharashtra slabs, ₹300 in February', () => {
  assert.equal(professionalTax(25_000, '2026-05'), 200);
  assert.equal(professionalTax(25_000, '2026-02'), 300);
  assert.equal(professionalTax(9_000, '2026-05'), 175);
  assert.equal(professionalTax(7_500, '2026-05'), 0);
  assert.equal(professionalTax(0, '2026-05'), 0);
});

test('slip fields: paid / LOP days, PT and fuel come off net pay, bank details pass through', () => {
  assert.equal(days.length, 26);
  const r = computePayroll(user, month, days.slice(1).map(present), [], [], settings, [
    { type: 'FUEL', amount: 300 },
    { type: 'ADVANCE', amount: 1000 },
  ]);
  assert.equal(r.workingDays, 26);
  assert.equal(r.paidDays, 25);
  assert.equal(r.lopDays, 1);
  assert.equal(r.payable, 25_000);
  assert.equal(r.professionalTax, 200);
  assert.equal(r.fuel, 300);
  assert.equal(r.netPay, 25_000 - 200 - 300 - 1000);
  assert.equal(r.bankName, 'AU Small Finance Bank');
});
