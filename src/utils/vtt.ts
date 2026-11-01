// WebVTT helpers shared by chapters and seek-thumbnail loading

import type { Chapter } from '../types';

export interface VttCue {
  startTime: number;
  endTime: number;
  url: string;
  /** Sprite crop rectangle. All zero when the cue points at a whole image (no #xywh fragment). */
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RawCue {
  startTime: number;
  endTime: number;
  payload: string[];
}

/** Parse "hh:mm:ss.ttt" / "mm:ss.ttt" / "ss.ttt" into seconds. Returns NaN when malformed. */
export function parseVttTime(str: string): number {
  if (!str.trim()) return NaN;
  const parts = str.trim().split(':').map(Number);
  if (parts.length === 0 || parts.length > 3 || parts.some(p => Number.isNaN(p))) return NaN;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function parseCues(text: string): RawCue[] {
  const cues: RawCue[] = [];
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const timingIdx = lines.findIndex(l => l.includes('-->'));
    if (timingIdx < 0) continue;

    const [startStr, rest = ''] = lines[timingIdx].split('-->');
    // Cue settings ("line:0 position:50%") may follow the end timestamp
    const startTime = parseVttTime(startStr);
    const endTime = parseVttTime(rest.trim().split(/\s+/)[0] ?? '');
    if (Number.isNaN(startTime) || Number.isNaN(endTime)) continue;

    cues.push({ startTime, endTime, payload: lines.slice(timingIdx + 1) });
  }

  return cues;
}

/** Parse a chapters WebVTT file: each cue's text becomes a chapter title. */
export function parseChaptersVtt(text: string): Chapter[] {
  const chapters: Chapter[] = [];
  for (const cue of parseCues(text)) {
    const title = cue.payload.join(' ').trim();
    if (!title) continue;
    chapters.push({ id: String(chapters.length + 1), title, startTime: cue.startTime, endTime: cue.endTime });
  }
  return chapters;
}

/**
 * Parse a thumbnails WebVTT file (`sprite.jpg#xywh=x,y,w,h` per cue).
 * Relative image URLs are resolved against `baseUrl` (the VTT file's own URL), as players and the
 * WebVTT thumbnail convention expect.
 */
export function parseVttThumbnails(text: string, baseUrl?: string): VttCue[] {
  const cues: VttCue[] = [];

  for (const cue of parseCues(text)) {
    const urlLine = cue.payload[0]?.trim();
    if (!urlLine) continue;

    const [rawUrl, fragment = ''] = urlLine.split('#');
    const match = fragment.match(/xywh=(\d+),(\d+),(\d+),(\d+)/);
    cues.push({
      startTime: cue.startTime,
      endTime: cue.endTime,
      url: resolveUrl(rawUrl, baseUrl),
      x: match ? parseInt(match[1], 10) : 0,
      y: match ? parseInt(match[2], 10) : 0,
      w: match ? parseInt(match[3], 10) : 0,
      h: match ? parseInt(match[4], 10) : 0,
    });
  }

  return cues;
}

function resolveUrl(url: string, baseUrl?: string): string {
  if (!baseUrl) return url;
  try {
    return new URL(url, baseUrl).href;
  } catch {
    // blob:/data: bases cannot resolve relative paths — keep the URL as written
    return url;
  }
}
