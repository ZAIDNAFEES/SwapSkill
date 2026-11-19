/**
 * DateTime validation and timezone utilities for SwapSkill session scheduling.
 * Ensures consistent, dynamic local timezone validation without hardcoded dates.
 */

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * Returns the local date string formatted as YYYY-MM-DD
 */
export function getLocalDateString(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Returns the local time string formatted as HH:mm
 */
export function getLocalTimeString(d: Date = new Date()): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Deterministically parses date string (YYYY-MM-DD) and time string (HH:mm) into a local Date object.
 */
export function parseLocalDateTime(dateStr: string, timeStr: string = "00:00"): Date {
  if (!dateStr) return new Date(NaN);
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hours, minutes] = (timeStr || "00:00").split(":").map(Number);
  return new Date(year, month - 1, day, hours || 0, minutes || 0, 0, 0);
}

/**
 * Returns true if a specific time slot on a given date is in the past compared to the dynamic current time.
 * - Future dates: ALWAYS false (all time slots are selectable).
 * - Today: ONLY true if the time slot has already passed relative to `now`.
 * - Past dates: ALWAYS true.
 */
export function isPastTimeSlot(dateStr: string, slotTimeStr: string, now: Date = new Date()): boolean {
  if (!dateStr || !slotTimeStr) return false;
  const todayStr = getLocalDateString(now);

  // Future dates have no past time slots
  if (dateStr > todayStr) {
    return false;
  }

  // Past dates are entirely in the past
  if (dateStr < todayStr) {
    return true;
  }

  // If selected date is today, compare exact hours & minutes against current local time
  const targetDate = parseLocalDateTime(dateStr, slotTimeStr);
  return targetDate.getTime() <= now.getTime();
}

/**
 * Returns true if the selected date and time is in the past.
 */
export function isPastDateTime(dateStr: string, timeStr: string, now: Date = new Date()): boolean {
  if (!dateStr || !timeStr) return true;
  const targetDate = parseLocalDateTime(dateStr, timeStr);
  if (isNaN(targetDate.getTime())) return true;
  return targetDate.getTime() <= now.getTime();
}

/**
 * Validates a session date/time immediately before submitting.
 * Returns { isValid: true, date: Date } or { isValid: false, error: string }.
 */
export function validateSessionDateTime(
  dateTimeStr: string,
  now: Date = new Date()
): { isValid: boolean; error?: string; date?: Date } {
  if (!dateTimeStr) {
    return { isValid: false, error: "Please select a date and time for the session." };
  }

  const [datePart, timePart] = dateTimeStr.includes("T") 
    ? dateTimeStr.split("T") 
    : [dateTimeStr, "00:00"];

  if (!datePart || !timePart) {
    return { isValid: false, error: "Please select a valid date and time." };
  }

  const selectedDate = parseLocalDateTime(datePart, timePart);

  if (isNaN(selectedDate.getTime())) {
    return { isValid: false, error: "Invalid date or time format. Please try again." };
  }

  if (selectedDate.getTime() <= now.getTime()) {
    return { isValid: false, error: "Please select a future time." };
  }

  return { isValid: true, date: selectedDate };
}

/**
 * Rounds a datetime local string to the nearest 15 minutes, ensuring it does not round back into the past.
 */
export function roundToNearest15(dateTimeStr: string, ensureFuture: boolean = true): string {
  if (!dateTimeStr) return "";
  const [datePart, timePart] = dateTimeStr.includes("T") ? dateTimeStr.split("T") : [dateTimeStr, "00:00"];
  const date = parseLocalDateTime(datePart, timePart);
  
  if (isNaN(date.getTime())) return dateTimeStr;

  const minutes = date.getMinutes();
  const roundedMinutes = Math.round(minutes / 15) * 15;
  date.setMinutes(roundedMinutes);
  date.setSeconds(0);
  date.setMilliseconds(0);

  if (ensureFuture) {
    const now = new Date();
    if (date.getTime() <= now.getTime()) {
      date.setMinutes(date.getMinutes() + 15);
    }
  }

  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());

  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}
