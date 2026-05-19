export type TimeTheme = "day" | "night";

const TAIWAN_TIME_ZONE = "Asia/Taipei";
const DAY_START_HOUR = 6;
const NIGHT_START_HOUR = 18;

export function getCurrentTimeTheme(date = new Date()): TimeTheme {
  const hour = getTaiwanHour(date);
  return hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR ? "day" : "night";
}

function getTaiwanHour(date: Date) {
  const hour = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: TAIWAN_TIME_ZONE
  }).format(date);
  return Number(hour);
}
