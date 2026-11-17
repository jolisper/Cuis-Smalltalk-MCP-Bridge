import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pidsHoldingFile } from '../processInfo.js';
import { buildRunScript } from '../startScript.js';
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

  describe('run script', () => {
    async function setupRun(config: Record<string, unknown>) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-runvm-'));
      cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
      const image = path.join(dir, 'Cuis.image');
      const changes = path.join(dir, 'Cuis.changes');
      const ready = path.join(dir, 'ready');
      const code = path.join(dir, 'code.st');
      const outcome = path.join(dir, 'outcome');
      const vm = path.join(dir, 'vm.sh');
      await fs.writeFile(image, 'IMG\n');
      await fs.writeFile(changes, 'CHG\n');
      await fs.writeFile(code, '3 + 4');
      const scriptFile = path.join(dir, 'run.st');
      await fs.writeFile(
        scriptFile,
        buildRunScript({ readyFile: ready, signalTrapPackage: '/x/SignalTrap.pck.st', codeFile: code, outcomeFile: outcome, nonce: 'N123' }),
      );
      await writeFakeVm(vm, { running: true });
      await writeFakeVmConfig(dir, config);
      const child = spawn(vm, ['-headless', image, '-s', scriptFile], { stdio: ['ignore', 'pipe', 'ignore'] });
      cleanups.push(() => void child.kill('SIGKILL'));
      let stdout = '';
      child.stdout!.on('data', (d) => (stdout += d.toString()));
      const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
      return { child, image, changes, ready, outcome, exited, out: () => stdout };
    }

    it('passed: prints BEGIN/code/END and writes the outcome', async () => {
      const r = await setupRun({ result: "a\\b\nc", elapsedMs: 9 });
      expect(await waitFor(r.ready)).toBe('armed=true');
      const outcome = await waitFor(r.outcome);
      expect(outcome).toBe('status=passed\nelapsedMs=9\nresult=a\\\\b\\nc\nresultTruncated=false\nerror=\ndone\n');
      expect(r.out()).toMatch(/\nN123 BEGIN\n3 \+ 4\nN123 END\n/);
      expect(r.child.exitCode).toBeNull();
    });

    it('passed defaults: result nil, elapsed 5', async () => {
      const r = await setupRun({});
      expect(await waitFor(r.outcome)).toBe('status=passed\nelapsedMs=5\nresult=nil\nresultTruncated=false\nerror=\ndone\n');
    });

    it('failed: status failed with error', async () => {
      const r = await setupRun({ run: 'failed' });
      expect(await waitFor(r.outcome)).toBe('status=failed\nelapsedMs=5\nresult=\nresultTruncated=false\nerror=ZeroDivide\ndone\n');
    });

    it('hang: BEGIN but no outcome, stays alive', async () => {
      const r = await setupRun({ run: 'hang' });
      await waitFor(r.ready);
      await sleep(400);
      expect(r.out()).toContain('N123 BEGIN');
      expect(r.out()).not.toContain('N123 END');
      await expect(fs.stat(r.outcome)).rejects.toThrow();
      expect(r.child.exitCode).toBeNull();
    });

    it('quit: BEGIN then exit 0 without END or outcome', async () => {
      const r = await setupRun({ run: 'quit' });
      expect(await r.exited).toBe(0);
      expect(r.out()).toContain('N123 BEGIN');
      expect(r.out()).not.toContain('N123 END');
      await expect(fs.stat(r.outcome)).rejects.toThrow();
    });

    it('flood: writes floodBytes then END and outcome', async () => {
      const r = await setupRun({ run: 'flood', floodBytes: 50000 });
      await waitFor(r.outcome);
      expect(r.out()).toContain('N123 END');
      expect(r.out().length).toBeGreaterThan(50000);
      expect(r.out()).not.toContain('3 + 4');
    });

    it('saveImage: overwrites image and changes before the outcome', async () => {
      const r = await setupRun({ run: 'saveImage' });
      await waitFor(r.outcome);
      expect(await fs.readFile(r.image, 'utf8')).toBe('SAVED-BY-RUN\n');
      expect(await fs.readFile(r.changes, 'utf8')).toBe('SAVED-BY-RUN\n');
    });

    it('mutate: appends MUTATED to image and changes', async () => {
      const r = await setupRun({ run: 'mutate' });
      await waitFor(r.outcome);
      expect(await fs.readFile(r.image, 'utf8')).toBe('IMG\nMUTATED');
      expect(await fs.readFile(r.changes, 'utf8')).toBe('CHG\nMUTATED');
    });

    it('neverReady: no ready file, no output, stays alive', async () => {
      const r = await setupRun({ run: 'neverReady' });
      await sleep(400);
      await expect(fs.stat(r.ready)).rejects.toThrow();
      expect(r.out()).not.toContain('BEGIN');
      expect(r.child.exitCode).toBeNull();
    });

    it('SIGTERM save still works for run scripts', async () => {
      const r = await setupRun({ run: 'hang', onTerm: 'save' });
      await waitFor(r.ready);
      r.child.kill('SIGTERM');
      expect(await r.exited).toBe(0);
      expect(await fs.readFile(r.image, 'utf8')).toBe('IMG\nsaved\n');
    });
  });
});
