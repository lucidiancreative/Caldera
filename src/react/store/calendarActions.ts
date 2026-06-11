import type { AiEvent, CalData, CalendarEvent, DayData } from '../../types';
import { saveCalData } from './calStore';

function generateCalendarEntryId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getDayData(calData: CalData, key: string): DayData | undefined {
  const value = calData[key];
  if (value && typeof value === 'object' && 'events' in value) return value as DayData;
  return undefined;
}

function getOrInitDayData(calData: CalData, key: string): DayData {
  if (!calData[key] || typeof calData[key] !== 'object' || !('events' in (calData[key] as object))) {
    calData[key] = { events: [], featuredId: null, timeBlocks: [] };
  }
  const day = calData[key] as DayData;
  if (!day.timeBlocks) day.timeBlocks = [];
  return day;
}

function pruneEmptyDayEntry(calData: CalData, key: string): void {
  const day = getDayData(calData, key);
  if (!day) return;
  if (!day.events.length) {
    delete calData[key];
    return;
  }
  if (!day.events.find((event) => event.id === day.featuredId)) {
    day.featuredId = day.events[0].id;
  }
}

function toElectronFileUrl(absPath: string): string {
  return 'file:///' + absPath.replace(/\\/g, '/');
}

export async function resolveCalendarImageUrl(relPath: string): Promise<string> {
  const fullPath = await window.calAPI.resolveImage(relPath);
  return toElectronFileUrl(fullPath);
}

export async function addEventWithImage(calData: CalData, key: string, id: string, relPath: string): Promise<void> {
  const day = getOrInitDayData(calData, key);
  day.events.push({ id, image: relPath, notes: '', time: '' });
  if (!day.featuredId) day.featuredId = id;
  await saveCalData();
}

export async function addEventFromPath(calData: CalData, key: string, srcPath: string): Promise<void> {
  window.calderaBridge?.pushSnapshot();
  const id = generateCalendarEntryId();
  const fileName = `${key}-${id}`;
  const relPath = await window.calAPI.copyImage(srcPath, fileName);
  await addEventWithImage(calData, key, id, relPath);
}

export async function addEventFromImageBuffer(
  calData: CalData,
  key: string,
  bytes: Uint8Array,
  ext: '.png' | '.jpg' | '.webp',
): Promise<void> {
  window.calderaBridge?.pushSnapshot();
  const id = generateCalendarEntryId();
  const fileName = `${key}-${id}`;
  const relPath = await window.calAPI.saveImageBuffer(Array.from(bytes), fileName, ext);
  await addEventWithImage(calData, key, id, relPath);
}

export async function addEmptyEvent(calData: CalData, key: string): Promise<void> {
  window.calderaBridge?.pushSnapshot();
  const day = getOrInitDayData(calData, key);
  const id = generateCalendarEntryId();
  day.events.push({ id, image: null, notes: '', time: '' });
  if (!day.featuredId) day.featuredId = id;
  await saveCalData();
}

export async function removeEvent(calData: CalData, key: string, eventId: string): Promise<void> {
  window.calderaBridge?.pushSnapshot();
  const day = getDayData(calData, key);
  if (!day) return;
  const event = day.events.find((entry) => entry.id === eventId);
  if (event?.image) await window.calAPI.deleteImage(event.image);
  day.events = day.events.filter((entry) => entry.id !== eventId);
  if (day.featuredId === eventId) day.featuredId = day.events[0]?.id || null;
  pruneEmptyDayEntry(calData, key);
  await saveCalData();
}

export async function setFeaturedCalendarEvent(calData: CalData, key: string, eventId: string): Promise<void> {
  window.calderaBridge?.pushSnapshot();
  const day = getDayData(calData, key);
  if (!day) return;
  day.featuredId = eventId;
  await saveCalData();
}

export async function saveEventField(
  calData: CalData,
  key: string,
  eventId: string,
  field: keyof CalendarEvent,
  value: string,
): Promise<void> {
  window.calderaBridge?.pushSnapshot();
  const day = getDayData(calData, key);
  if (!day) return;
  const event = day.events.find((entry) => entry.id === eventId);
  if (!event) return;
  if (value) (event as unknown as Record<string, unknown>)[field] = value;
  else delete (event as unknown as Record<string, unknown>)[field];
  await saveCalData();
}

export async function assignEventImage(calData: CalData, key: string, eventId: string, srcPath: string): Promise<void> {
  window.calderaBridge?.pushSnapshot();
  const day = getDayData(calData, key);
  const event = day?.events.find((entry) => entry.id === eventId);
  if (!event) return;
  if (event.image) await window.calAPI.deleteImage(event.image);
  const fileName = `${key}-${eventId}`;
  event.image = await window.calAPI.copyImage(srcPath, fileName);
  const hasFeaturedImage = day!.events.find((entry) => entry.id === day!.featuredId)?.image;
  if (!hasFeaturedImage) day!.featuredId = eventId;
  await saveCalData();
}

export async function removeEventImage(calData: CalData, key: string, eventId: string): Promise<void> {
  window.calderaBridge?.pushSnapshot();
  const day = getDayData(calData, key);
  const event = day?.events.find((entry) => entry.id === eventId);
  if (!event?.image) return;
  await window.calAPI.deleteImage(event.image);
  event.image = null;
  if (day!.featuredId === eventId) {
    const otherFeatured = day!.events.find((entry) => entry.id !== eventId && entry.image);
    day!.featuredId = otherFeatured?.id || day!.events.find((entry) => entry.id !== eventId)?.id || null;
  }
  await saveCalData();
}

export async function addAiEvents(calData: CalData, events: AiEvent[]): Promise<void> {
  if (!events.length) return;
  window.calderaBridge?.pushSnapshot();
  for (const event of events) {
    const day = getOrInitDayData(calData, event.date);
    const id = generateCalendarEntryId();
    const noteParts = [event.title, event.notes, event.sourceUrl].filter(Boolean);
    day.events.push({ id, image: null, notes: noteParts.join('\n'), time: event.time || '' });
    if (!day.featuredId) day.featuredId = id;
  }
  await saveCalData();
}
