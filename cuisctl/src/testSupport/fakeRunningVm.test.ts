import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pidsHoldingFile } from '../processInfo.js';
import { writeFakeVm, writeFakeVmConfig } from './fakeVm.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

describe('fake running VM', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  async function setup(config: Record<string, unknown>, port: number | 'none' = 'none') {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-runvm-'));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    const image = path.join(dir, 'Cuis.image');
    const changes = path.join(dir, 'Cuis.changes');
    const ready = path.join(dir, 'ready');
    const scriptFile = path.join(dir, 'start.st');
    const vm = path.join(dir, 'vm.sh');
    await fs.writeFile(image, 'IMG\n');
    await fs.writeFile(changes, '');
    await fs.writeFile(scriptFile, `| a |\n"cuisctl-ready: ${ready}" "cuisctl-bridge-port: ${port}"\n`);
    await writeFakeVm(vm, { running: true });
    await writeFakeVmConfig(dir, config);
    const child = spawn(vm, ['-headless', image, '-s', scriptFile, '-ApplePersistenceIgnoreState', 'YES'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    cleanups.push(() => void child.kill('SIGKILL'));
    const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
    return { child, image, changes, ready, exited };
  }

  async function waitFor(file: string): Promise<string> {
    for (let i = 0; i < 100; i++) {
      try {
        const t = await fs.readFile(file, 'utf8');
        if (t) return t;
      } catch {}
      await sleep(50);
    }
    throw new Error(`timeout waiting for ${file}`);
  }

  it('writes the ready file and holds .changes open', async () => {
    const { child, changes, ready } = await setup({});
    expect(await waitFor(ready)).toBe('armed=true');
    expect(await pidsHoldingFile(changes)).toContain(child.pid);
  });

  it('answers a handshake on the marker port', async () => {
    const port = await freePort();
    const { ready } = await setup({ bridge: true }, port);
    await waitFor(ready);
    const reply = await new Promise<string>((resolve, reject) => {
      const s = net.connect(port, '127.0.0.1', () => s.write('{"hello":1}\n'));
      s.on('data', (d) => {
        s.destroy();
        resolve(d.toString());
      });
      s.on('error', reject);
    });
    expect(JSON.parse(reply).ok).toBe(true);
  });

  it('SIGTERM with onTerm save grows the image and exits 0', async () => {
    const { child, image, ready, exited } = await setup({ onTerm: 'save' });
    await waitFor(ready);
    const before = (await fs.stat(image)).size;
    child.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect((await fs.stat(image)).size).toBeGreaterThan(before);
  });

  it('exitEarly exits 1', async () => {
    const { exited } = await setup({ exitEarly: true });
    expect(await exited).toBe(1);
  });
});
