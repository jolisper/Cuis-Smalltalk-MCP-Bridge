#!/usr/bin/env node
/**
 * Process entry for cuisctl: wires runCli to argv, env, stdout and stderr.
 * Sets process.exitCode instead of calling process.exit() so stdout flushes.
 * Only `run --stdin` reads stdin (through runCli's readStdin seam); a TTY is
 * never read, so nothing waits for a person to type. Progress messages go to
 * stderr; stdout carries exactly one document (runCli's result). SIGINT and
 * SIGTERM abort an AbortController whose signal is passed to runCli, so an
 * interrupted run restores the image and releases the lock before exit. The
 * test-only CUISCTL_HOME override is read inside runCli from the env passed
 * here, not in this file.
 */
import { runCli } from './runCli.js';

async function readStdin(): Promise<{ text: string; isTTY: boolean }> {
  if (process.stdin.isTTY === true) return { text: '', isTTY: true };
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  } catch {
    // closed or unreadable stdin counts as empty
  }
  return { text: Buffer.concat(chunks).toString('utf8'), isTTY: false };
}

const controller = new AbortController();
const abort = (): void => controller.abort();
process.on('SIGINT', abort);
process.on('SIGTERM', abort);

const { stdout, exitCode } = await runCli(process.argv.slice(2), {
  env: process.env,
  platform: process.platform,
  onProgress: (m) => process.stderr.write(m + '\n'),
  readStdin,
  signal: controller.signal,
});
process.stdout.write(stdout);
process.exitCode = exitCode;
