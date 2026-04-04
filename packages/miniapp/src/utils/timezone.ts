/**
 * Returns the user's local time string ("HH:MM") for a given UTC hour.
 * Uses the browser's detected timezone.
 */
export function utcHourToLocalTimeString(utcHour: number): string {
  // Build a Date in UTC at the given hour on an arbitrary day
  const d = new Date();
  d.setUTCHours(utcHour, 0, 0, 0);

  // Format in user's local timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }).format(d);

  // Normalise "24:00" → "00:00" (midnight edge-case some engines emit)
  return parts === '24:00' ? '00:00' : parts;
}

/**
 * Converts a local time string ("HH:MM" from <input type="time">) back to a UTC hour (0-23).
 */
export function localTimeStringToUtcHour(timeString: string): number {
  const [localHoursStr, minutesStr] = timeString.split(':');
  const localHours = Number(localHoursStr);
  const minutes = Number(minutesStr ?? 0);

  // Create a Date with the chosen local hour/minute so JS can convert it to UTC
  const d = new Date();
  d.setHours(localHours, minutes, 0, 0);

  return d.getUTCHours();
}
