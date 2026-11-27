// Time-of-day greeting in India time (Asia/Kolkata), whatever timezone the
// viewer's computer clock is set to. Morning until 12:00, afternoon until 17:00,
// evening after that.

/** Hour of the day (0–23) in India for the given moment. */
export function indiaHour(at: Date = new Date()): number {
  const h = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(at);
  return Number(h) % 24;
}

export function greetingFor(hour: number): 'Good morning' | 'Good afternoon' | 'Good evening' {
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}
