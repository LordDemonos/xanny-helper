/**
 * Parse a time string for the raid night schedule (e.g. "7pm", "19:00").
 * Interpreted as EST; returns hour (0-23) and minute (0-59).
 */
export function parseScheduleTime(input: string): { hour: number; minute: number } | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  // 24h form: 19:00, 7:30, 09:00
  const twentyFour = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFour) {
    const hour = parseInt(twentyFour[1], 10);
    const minute = parseInt(twentyFour[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
    return null;
  }

  // 12h form: 7pm, 7 pm, 7:30pm, 7:30 pm
  const twelve = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (twelve) {
    let hour = parseInt(twelve[1], 10);
    const minute = twelve[2] != null ? parseInt(twelve[2], 10) : 0;
    const isPm = twelve[3] === 'pm';
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    if (isPm && hour !== 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
    return { hour, minute };
  }

  // Bare hour: "9" or "09" -> 9 AM (default morning)
  const bare = trimmed.match(/^(\d{1,2})$/);
  if (bare) {
    const hour = parseInt(bare[1], 10);
    if (hour >= 0 && hour <= 12) return { hour: hour === 12 ? 0 : hour, minute: 0 };
    if (hour >= 13 && hour <= 23) return { hour, minute: 0 };
    return null;
  }

  return null;
}
