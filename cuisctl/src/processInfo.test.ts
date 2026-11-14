import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pidsHoldingFile, processCommand, processStartTime } from './processInfo.js';

describe('cuisctl processInfo', () => {
  it('reports the start time of a live process in C-locale lstart format', async () => {
    // Given
    const pid = process.pid;

    // When
    const startTime = await processStartTime(pid);

    // Then
    expect(startTime).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/);
  });

  it('reports undefined for a process that no longer exists', async () => {
    // Given
    const child = spawn('true');
    await new Promise((resolve) => child.on('exit', resolve));

    // When
    const startTime = processStartTime(child.pid!);

    // Then
    await expect(startTime).resolves.toBeUndefined();
  });

  it('reports the command line of a live process', async () => {
    // Given
    const child = spawn('sleep', ['30']);
    try {
      // When
      const command = await processCommand(child.pid!);

      // Then
      expect(command).toContain('sleep 30');
    } finally {
      child.kill();
    }
  });

  it('reports undefined command for a process that no longer exists', async () => {
    // Given
    const child = spawn('true');
    await new Promise((resolve) => child.on('exit', resolve));

    // When
    const command = processCommand(child.pid!);

    // Then
    await expect(command).resolves.toBeUndefined();
  });

  it('finds the pid of a process holding a file open', async () => {
    // Given
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-'));
    const file = path.join(dir, 'held.changes');
    await fs.writeFile(file, '');
    const child = spawn('sh', ['-c', 'exec sleep 30 3<"$0"', file]);
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));

      // When
      const pids = await pidsHoldingFile(file);

      // Then
      expect(pids).toContain(child.pid);
    } finally {
      child.kill();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('reports no pids for a file that no process holds open', async () => {
    // Given
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-'));
    const file = path.join(dir, 'unheld.changes');
    await fs.writeFile(file, '');
    try {
      // When
      const pids = pidsHoldingFile(file);

      // Then
      await expect(pids).resolves.toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
