/**
 * Run outcome: what a code run reports back, in two parts.
 *
 * 1. Outcome file (`parseOutcomeFile`)
 *    Plain text, one `key=value` line per field, split at the FIRST '='
 *    (values may contain '='). Fields: status ('passed' | 'failed'), elapsedMs,
 *    result, resultTruncated ('true' when the image already truncated the result),
 *    error. Later lines override earlier ones with the same key.
 *    Values `result` and `error` are escaped so they fit on one line: `\n` is a
 *    newline, `\r` a carriage return, and `\X` for any other X is the literal X
 *    (so `\\` is a backslash).
 *    The file is only complete once its last line is the sentinel `done`; until
 *    then the writer may still be mid-write and parsing yields `undefined`.
 *    The result is capped at RESULT_CAP characters; exceeding it sets
 *    `resultTruncated`.
 *
 * 2. Captured output (`captureOutput`)
 *    The image's log file is shared and unbounded, and the run's output is
 *    delimited inside it by two marker lines carrying a per-run nonce:
 *        \n<nonce> BEGIN\n  ...output...  \n<nonce> END\n
 *    Each marker line may carry the Transcript prefix (`<timestamp> process:<n> <n> `)
 *    before `<nonce> BEGIN|END`; the marker must start a line, after that optional prefix.
 *    The output is the raw bytes between the BEGIN line and the LF that starts the END
 *    line; the prefix is removed from the start of every returned line.
 *    BEGIN is searched forward from the byte offset recorded before the run
 *    started; END is searched backward from the end of the file (the last END
 *    wins, and a missing END means the output runs to end of file).
 *    Memory stays bounded regardless of log size: the file is scanned in
 *    SCAN_CHUNK pieces, and when the output exceeds HEAD_BYTES + TAIL_BYTES only
 *    its first HEAD_BYTES (16K) and last TAIL_BYTES (48K) are read, and
 *    `outputTruncated` is set. `outputBytes` is always the full RAW output size (prefixes included).
 */
import { open, type FileHandle } from 'node:fs/promises';

export type ParsedOutcome = {
  status: 'passed' | 'failed';
  elapsedMs: number;
  result: string;
  resultTruncated: boolean;
  error: string;
};

export type CapturedOutput = {
  output: string;
  outputBytes: number;
  outputTruncated: boolean;
};

/** Maximum characters of `result` kept. */
const RESULT_CAP = 4096;
/** Bytes kept from the start of oversized output. */
const HEAD_BYTES = 16384;
/** Bytes kept from the end of oversized output. */
const TAIL_BYTES = 49152;
/** Bytes read per step while scanning the log for a marker. */
const SCAN_CHUNK = 65536;

/** Prefix the Transcript may put before every log line (timestamp, process, id). */
const TRANSCRIPT_PREFIX = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3} process:\d+ \d+ /;
/** Bytes read before a marker to find its line start and prefix. */
const PREFIX_WINDOW = 64;

const OUTCOME_SENTINEL = '\ndone';

export function parseOutcomeFile(text: string): ParsedOutcome | undefined {
  if (!isComplete(text)) {
    return undefined;
  }
  const fields = parseFields(text);
  const fullResult = unescapeValue(fields.get('result') ?? '');
  const oversized = fullResult.length > RESULT_CAP;
  return {
    status: fields.get('status') as 'passed' | 'failed',
    elapsedMs: Number(fields.get('elapsedMs')),
    result: oversized ? fullResult.slice(0, RESULT_CAP) : fullResult,
    resultTruncated: oversized || fields.get('resultTruncated') === 'true',
    error: unescapeValue(fields.get('error') ?? ''),
  };
}

export async function captureOutput(logFile: string, offset: number, nonce: string): Promise<CapturedOutput> {
  const handle = await open(logFile, 'r');
  try {
    const size = (await handle.stat()).size;
    const begin = Buffer.from(`${nonce} BEGIN\n`);
    const end = Buffer.from(`${nonce} END\n`);
    const atLineStart = (at: number) => lineStartOf(handle, at).then((line) => line >= 0);
    const beginAt = await findForward(handle, offset, size, begin, atLineStart);
    if (beginAt < 0) {
      return { output: '', outputBytes: 0, outputTruncated: false };
    }
    const start = beginAt + begin.length;
    const endAt = await findBackward(handle, start, size, end, atLineStart);
    const stop = endAt < 0 ? size : Math.max(start, (await lineStartOf(handle, endAt)) - 1);
    const length = stop - start;
    if (length > HEAD_BYTES + TAIL_BYTES) {
      const head = await readAt(handle, start, HEAD_BYTES);
      const tail = await readAt(handle, stop - TAIL_BYTES, TAIL_BYTES);
      return { output: stripPrefixes(Buffer.concat([head, tail])), outputBytes: length, outputTruncated: true };
    }
    const body = await readAt(handle, start, length);
    return { output: stripPrefixes(body), outputBytes: length, outputTruncated: false };
  } finally {
    await handle.close();
  }
}

function stripPrefixes(raw: Buffer): string {
  return raw.toString('utf8').replace(new RegExp(`^${TRANSCRIPT_PREFIX.source}`, 'gm'), '');
}

/**
 * Start offset of the line holding the marker at `markerAt`, or -1 when the marker is not at
 * line start (only an optional Transcript prefix may precede it, right after a LF).
 */
async function lineStartOf(handle: FileHandle, markerAt: number): Promise<number> {
  const from = Math.max(0, markerAt - PREFIX_WINDOW);
  const before = (await readAt(handle, from, markerAt - from)).toString('latin1');
  const lf = before.lastIndexOf('\n');
  if (lf < 0) {
    return -1;
  }
  const prefix = before.slice(lf + 1);
  const valid = prefix === '' || new RegExp(`^${TRANSCRIPT_PREFIX.source}$`).test(prefix);
  return valid ? markerAt - prefix.length : -1;
}

function isComplete(text: string): boolean {
  return text.endsWith(`${OUTCOME_SENTINEL}\n`) || text.endsWith(OUTCOME_SENTINEL);
}

function parseFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of text.split('\n')) {
    const index = line.indexOf('=');
    if (index >= 0) {
      fields.set(line.slice(0, index), line.slice(index + 1));
    }
  }
  return fields;
}

function unescapeValue(value: string): string {
  return value.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c));
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

type MarkerCheck = (markerAt: number) => Promise<boolean>;

/** Offset of the first accepted `pattern` at or after `from`, or -1. Chunks overlap so matches spanning a boundary are found. */
async function findForward(
  handle: FileHandle,
  from: number,
  size: number,
  pattern: Buffer,
  accept: MarkerCheck,
): Promise<number> {
  for (let position = from; position < size; position += SCAN_CHUNK) {
    const chunk = await readAt(handle, position, SCAN_CHUNK + pattern.length - 1);
    for (let found = chunk.indexOf(pattern); found >= 0; found = chunk.indexOf(pattern, found + 1)) {
      if (await accept(position + found)) {
        return position + found;
      }
    }
  }
  return -1;
}

/** Offset of the last accepted `pattern` at or after `lowerBound`, or -1. Chunks overlap so matches spanning a boundary are found. */
async function findBackward(
  handle: FileHandle,
  lowerBound: number,
  size: number,
  pattern: Buffer,
  accept: MarkerCheck,
): Promise<number> {
  for (let chunkEnd = size; chunkEnd > lowerBound; chunkEnd -= SCAN_CHUNK) {
    const chunkStart = Math.max(lowerBound, chunkEnd - SCAN_CHUNK);
    const chunk = await readAt(handle, chunkStart, Math.min(size, chunkEnd + pattern.length - 1) - chunkStart);
    for (let found = chunk.lastIndexOf(pattern); found >= 0; found = found > 0 ? chunk.lastIndexOf(pattern, found - 1) : -1) {
      if (await accept(chunkStart + found)) {
        return chunkStart + found;
      }
    }
  }
  return -1;
}
