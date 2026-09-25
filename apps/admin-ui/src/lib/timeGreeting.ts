/**
 * Time-of-day greeting in Asia/Kolkata (IST), for embed / executive shell.
 */

export function greetingForIstHour(now = new Date()): 'Good morning' | 'Good afternoon' | 'Good evening' {
  let hour = now.getHours();
  try {
    const raw = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      hour12: false,
    }).format(now);
    hour = Number(raw === '24' ? '0' : raw);
  } catch {
    /* use local hour */
  }
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Time-of-day greeting only. Name/title come from the embed URL or the logged-in session. */
export function personalGreeting(opts?: { now?: Date }): string {
  return greetingForIstHour(opts?.now);
}
