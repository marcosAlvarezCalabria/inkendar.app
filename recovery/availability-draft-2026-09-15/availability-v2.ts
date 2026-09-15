export const AVAILABILITY_LIMITS = { minDurationMinutes: 15, maxDurationMinutes: 480, maxRangeDays: 31, maxSlots: 500 } as const;
export type WeeklyWindow = Readonly<{ weekday: number; start: string; end: string }>;
export type AvailabilityRules = Readonly<{ timeZone: string; windows: readonly WeeklyWindow[]; slotIncrementMinutes: number; bufferBeforeMinutes: number; bufferAfterMinutes: number }>;
export type BusyInterval = Readonly<{ startUtc: string; endUtc: string }>;
export type AvailabilitySlot = Readonly<{ startUtc: string; endUtc: string; startLocal: string; endLocal: string }>;
type CivilDate = Readonly<{ year: number; month: number; day: number }>;

export class InvalidAvailabilityInputError extends Error {
  readonly code = "INVALID_AVAILABILITY_INPUT";
  constructor() { super("Availability input is invalid"); this.name = "InvalidAvailabilityInputError"; }
}

export function validateAvailabilityPreview(input: Readonly<{ rules: AvailabilityRules; rangeStart: string; rangeEnd: string; durationMinutes: number }>): void {
  validateRules(input.rules);
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < AVAILABILITY_LIMITS.minDurationMinutes || input.durationMinutes > AVAILABILITY_LIMITS.maxDurationMinutes) invalid();
  const first = parseUtc(input.rangeStart); const last = parseUtc(input.rangeEnd);
  if (last <= first || last.getTime() - first.getTime() > AVAILABILITY_LIMITS.maxRangeDays * 86_400_000) invalid();
}

export function candidateSlots(input: Readonly<{ rules: AvailabilityRules; rangeStart: string; rangeEnd: string; durationMinutes: number; busy: readonly BusyInterval[] }>): readonly AvailabilitySlot[] {
  validateAvailabilityPreview(input);
  const first = parseUtc(input.rangeStart); const last = parseUtc(input.rangeEnd);
  const busy = merge(input.busy.map((interval) => ({ start: parseUtc(interval.startUtc).getTime() - input.rules.bufferBeforeMinutes * 60_000, end: parseUtc(interval.endUtc).getTime() + input.rules.bufferAfterMinutes * 60_000 })));
  const slots: AvailabilitySlot[] = [];
  const firstCivil = civilAt(first, input.rules.timeZone); const lastCivil = civilAt(new Date(last.getTime() - 1), input.rules.timeZone);
  for (let serial = civilSerial(firstCivil); serial <= civilSerial(lastCivil); serial += 86_400_000) {
    const date = civilFromSerial(serial); const weekday = new Date(serial).getUTCDay();
    for (const window of input.rules.windows.filter((candidate) => candidate.weekday === weekday)) {
      const windowStart = resolveBoundary(date, window.start, input.rules.timeZone, "EARLIEST");
      const windowEnd = resolveBoundary(date, window.end, input.rules.timeZone, "LATEST");
      if (windowStart >= windowEnd) continue;
      for (let start = windowStart; start + input.durationMinutes * 60_000 <= windowEnd; start += input.rules.slotIncrementMinutes * 60_000) {
        const end = start + input.durationMinutes * 60_000;
        if (start < first.getTime() || end > last.getTime() || busy.some((interval) => start < interval.end && end > interval.start)) continue;
        slots.push({ startUtc: new Date(start).toISOString(), endUtc: new Date(end).toISOString(), startLocal: localIso(start, input.rules.timeZone), endLocal: localIso(end, input.rules.timeZone) });
        if (slots.length >= AVAILABILITY_LIMITS.maxSlots) return slots;
      }
    }
  }
  return slots;
}

export function validateRules(rules: AvailabilityRules): void {
  try { new Intl.DateTimeFormat("en", { timeZone: rules.timeZone }).format(); } catch { invalid(); }
  if (!Number.isInteger(rules.slotIncrementMinutes) || rules.slotIncrementMinutes < 5 || rules.slotIncrementMinutes > 240 || !Number.isInteger(rules.bufferBeforeMinutes) || !Number.isInteger(rules.bufferAfterMinutes) || rules.bufferBeforeMinutes < 0 || rules.bufferAfterMinutes < 0 || rules.bufferBeforeMinutes > 240 || rules.bufferAfterMinutes > 240 || rules.windows.length > 28) invalid();
  for (const window of rules.windows) if (!Number.isInteger(window.weekday) || window.weekday < 0 || window.weekday > 6 || !clock(window.start) || !clock(window.end) || window.start >= window.end) invalid();
  const ordered = [...rules.windows].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  for (let index = 1; index < ordered.length; index += 1) if (ordered[index - 1]!.weekday === ordered[index]!.weekday && ordered[index]!.start < ordered[index - 1]!.end) invalid();
}

function resolveBoundary(date: CivilDate, clockValue: string, timeZone: string, preference: "EARLIEST" | "LATEST"): number {
  let localSerial = Date.UTC(date.year, date.month - 1, date.day, ...clockValue.split(":").map(Number) as [number, number]);
  for (let shifted = 0; shifted <= 180; shifted += 1, localSerial += 60_000) {
    const shiftedDate = new Date(localSerial);
    const matches = matchingInstants({ year: shiftedDate.getUTCFullYear(), month: shiftedDate.getUTCMonth() + 1, day: shiftedDate.getUTCDate() }, `${pad(shiftedDate.getUTCHours())}:${pad(shiftedDate.getUTCMinutes())}`, timeZone);
    if (matches.length > 0) return preference === "EARLIEST" ? matches[0]! : matches.at(-1)!;
  }
  invalid();
}

function matchingInstants(date: CivilDate, clockValue: string, timeZone: string): number[] {
  const [hour, minute] = clockValue.split(":").map(Number); const wanted = Date.UTC(date.year, date.month - 1, date.day, hour, minute); const offsets = new Set<number>();
  for (const deltaHours of [-48, -36, -24, -12, 0, 12, 24, 36, 48]) { const instant = new Date(wanted + deltaHours * 3_600_000); const local = localParts(instant, timeZone); offsets.add((Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - instant.getTime()) / 60_000); }
  return [...offsets].map((offset) => wanted - offset * 60_000).filter((instant) => { const local = localParts(new Date(instant), timeZone); return local.year === date.year && local.month === date.month && local.day === date.day && local.hour === hour && local.minute === minute; }).sort((a, b) => a - b);
}
function civilAt(value: Date, timeZone: string): CivilDate { const local = localParts(value, timeZone); return { year: local.year, month: local.month, day: local.day }; }
function civilSerial(value: CivilDate): number { return Date.UTC(value.year, value.month - 1, value.day); }
function civilFromSerial(value: number): CivilDate { const date = new Date(value); return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }; }
function localParts(value: Date, timeZone: string) { const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(value).map((part) => [part.type, part.value])); return { year:Number(values.year), month:Number(values.month), day:Number(values.day), hour:Number(values.hour), minute:Number(values.minute) }; }
function localIso(value: number, timeZone: string): string { const local=localParts(new Date(value), timeZone); return `${local.year}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)}`; }
function parseUtc(value: string): Date { const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/u.exec(value); if (!match) invalid(); const [,year,month,day,hour,minute,second,millisecond="000"]=match; const date=new Date(value); if (!Number.isFinite(date.getTime()) || date.getUTCFullYear()!==Number(year) || date.getUTCMonth()+1!==Number(month) || date.getUTCDate()!==Number(day) || date.getUTCHours()!==Number(hour) || date.getUTCMinutes()!==Number(minute) || date.getUTCSeconds()!==Number(second) || date.getUTCMilliseconds()!==Number(millisecond)) invalid(); return date; }
function clock(value: string): boolean { return /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value); }
function pad(value: number): string { return String(value).padStart(2, "0"); }
function merge(items: {start:number;end:number}[]) { for (const item of items) if (!(item.end > item.start)) invalid(); const sorted=[...items].sort((a,b)=>a.start-b.start); const result:{start:number;end:number}[]=[]; for(const item of sorted){const previous=result.at(-1); if(previous && item.start<=previous.end) previous.end=Math.max(previous.end,item.end); else result.push({...item});} return result; }
function invalid(): never { throw new InvalidAvailabilityInputError(); }
