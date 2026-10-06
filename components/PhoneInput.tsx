'use client';

import { useState } from 'react';
import { COUNTRY_CODES, isoOf } from '@/lib/country-codes';
import { DEFAULT_CODE, PHONE_DIGITS, formatPhone, splitPhone } from '@/lib/phone';

// Country code (default +91) + exactly 10 digits. The value in and out is the
// stored form "+91 9876543210" ('' when empty). Only digits can be typed.
// Looks like one field: a flag + code button (the native picker sits on top of
// it, invisible) joined to the number, with a live "7/10" → ✓ counter.
export default function PhoneInput({ value, onChange, id, required, placeholder = '10-digit number', className = '', disabled }: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { code, number } = splitPhone(value);
  const set = (c: string, n: string) => onChange(formatPhone(c, n) || (c !== DEFAULT_CODE ? `${c} ` : ''));
  const partial = value && !number ? value.trim() : '';
  const shownCode = partial.startsWith('+') ? partial : code;
  const iso = isoOf(COUNTRY_CODES.find(([c]) => c === shownCode)?.[1] || '');
  const [badFlag, setBadFlag] = useState('');
  const n = number.length;
  const state = !n ? 'is-empty' : n === PHONE_DIGITS ? 'is-ok' : 'is-partial';
  return (
    <div className={`phone-in ${state}${disabled ? ' is-disabled' : ''}${!iso || badFlag === iso ? ' no-flag' : ''} ${className}`}>
      <span className="phone-cc">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {iso && <img src={`https://flagcdn.com/${iso}.svg`} alt="" width={22} height={16} onError={() => setBadFlag(iso)} />}
        <span className="phone-iso">{iso.toUpperCase() || '—'}</span>
        <span className="phone-cc-code">{shownCode}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        <select aria-label="Country code" value={shownCode} disabled={disabled} onChange={(e) => set(e.target.value, number)}>
          {COUNTRY_CODES.map(([c, f], i) => <option key={`${c}-${i}`} value={c}>{f} {c}</option>)}
        </select>
      </span>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        maxLength={PHONE_DIGITS}
        pattern={`\\d{${PHONE_DIGITS}}`}
        title={`Enter a ${PHONE_DIGITS}-digit number`}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        value={number}
        onChange={(e) => set(shownCode, e.target.value.replace(/\D/g, '').slice(0, PHONE_DIGITS))}
      />
      <span className="phone-count" aria-hidden="true">{n === PHONE_DIGITS ? '✓' : `${n}/${PHONE_DIGITS}`}</span>
    </div>
  );
}
