// Opt-in real-Cuis checks: real download of the pinned Cuis and real headless VM runs.
// Run with CUISCTL_REAL_CUIS=1 on macOS. Uses a fresh temp home, never ~/.cuisctl.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runDestroy } from './commands/destroy.js';
import { runReset } from './commands/reset.js';
import { runStart } from './commands/start.js';
import type { StartView } from './commands/start.js';
import { runStatus } from './commands/status.js';
import { runStop } from './commands/stop.js';
import type { StopView } from './commands/stop.js';
import { ensureHome } from './home.js';
import { createInstance, listInstances } from './instance.js';
import { runScript, spawnVm } from './launcher.js';
import { renderText } from './output.js';
import { cuisBaseDir, cuisDistDir, cuisKeyDir, instancePaths } from './paths.js';
import { CUIS_KEY, CUIS_VM_PATH } from './pin.js';
import { pidsHoldingFile } from './processInfo.js';
import { signalTrapPackageFile } from './startScript.js';

const PREPARE_TIMEOUT_MS = 300_000;
const RUN_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 180_000;
const START_TIMEOUT_MS = 60_000;
const LIFECYCLE_TIMEOUT_MS = 300_000;
const PROTOCOL_FILE = path.resolve(import.meta.dirname, '../../mcp-bridge/server/src/protocol.ts');
const execFileP = promisify(execFile);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const BRIDGE_PACKAGE = path.resolve(import.meta.dirname, '../../mcp-bridge/image/MCP-Bridge.pck.st');

// Compiling code asks for author initials (a modal prompt, hanging a headless run) unless set.
const HEAD = "Transcript logToStdout: true.\nUtilities setAuthorName: 'Test' initials: 'tst'.\n";
const TAIL = "Transcript show: 'DONE exitCode=0'; newLine.\nSmalltalk quitPrimitive: 0\n";
const show = (expr: string) => `Transcript show: ${expr}; newLine.\n`;

const USER_FOLDERS_SCRIPT =
  HEAD +
  "Object compile: 'probeItem8 ^8' classified: 'probe'.\n" +
  ['userChanges', 'fileOuts', 'logs', 'savedChangeSets', 'newPackages']
    .map((n) => show(`'${n}=', DirectoryEntry ${n}Directory pathName`))
    .join('') +
  show("'userBase=', DirectoryEntry userBaseDirectory pathName") +
  TAIL;

const LINKS_SCRIPT = (pck: string) =>
  HEAD +
  show("'coreUpdatesDirectory exists ', DirectoryEntry coreUpdatesDirectory exists printString") +
  show("'packagesDirectory exists ', DirectoryEntry packagesDirectory exists printString") +
  `CodePackageFile installPackage: '${pck}' asFullFileEntry.\n` +
  show("'bridge defined ', (Smalltalk includesKey: #McpBridgeServer) printString") +
  TAIL;

const A_SAVE_JSON_SCRIPT =
  HEAD +
  "Feature require: 'JSON'.\n" +
  "(Smalltalk at: #Json) compile: 'probeFromA ^ 1' classified: 'probe'.\n" +
  "(CodePackage installedPackages at: 'JSON') save.\n" +
  show("'saved ', (CodePackage installedPackages at: 'JSON') fullFileName asString") +
  TAIL;

const B_LOAD_JSON_SCRIPT =
  HEAD +
  "Feature require: 'JSON'.\n" +
  show("'hasProbeFromA ', ((Smalltalk at: #Json) includesSelector: #probeFromA) printString") +
  show("'loadedFrom ', (CodePackage installedPackages at: 'JSON') fullFileName asString") +
  TAIL;

const A_SAVE_SHARED_SCRIPT =
  HEAD +
  "Object subclass: #ProbeSharedThing instanceVariableNames: '' classVariableNames: '' poolDictionaries: '' category: 'ProbeShared'.\n" +
  "(Smalltalk at: #ProbeSharedThing) compile: 'answer ^ 42' classified: 'probe'.\n" +
  "pkg := CodePackage named: 'ProbeShared' createIfAbsent: true registerIfNew: true.\n" +
  "pkg fullFileName: (DirectoryEntry newPackagesDirectory // pkg packageFileName) pathName.\n" +
  'pkg save.\n' +
  show("'saved ', pkg fullFileName asString") +
  TAIL;

const B_REQUIRE_SHARED_SCRIPT =
  HEAD +
  "Feature require: 'ProbeShared'.\n" +
  show("'answer=', (Smalltalk at: #ProbeSharedThing) new answer printString") +
  TAIL;

/** Sorted `path sha256` lines for every regular file (following symlinks) under `dir`. */
async function snapshot(dir: string): Promise<string[]> {
  const lines: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isSymbolicLink()) lines.push(`${path.relative(dir, full)} -> ${await fs.readlink(full)}`);
      else if (entry.isFile()) {
        lines.push(`${path.relative(dir, full)} ${createHash('sha256').update(await fs.readFile(full)).digest('hex')}`);
      }
    }
  }
  await walk(dir);
  return lines.sort();
}

describe.skipIf(process.env.CUISCTL_REAL_CUIS !== '1' || process.platform !== 'darwin')(
  'real Cuis (cuisctl home and instances)',
  () => {
    let root: string;
    let home: string;
    let scripts: string;
    let vm: string;
    let distBefore: string[];
    let baseBefore: string[];

    async function run(instance: string, name: string, script: string) {
      const file = path.join(scripts, `${instance}-${name}.st`);
      await fs.writeFile(file, script);
      const p = instancePaths(home, instance);
      const result = await runScript({
        vm,
        image: p.image,
        script: file,
        cwd: p.files,
        timeoutMs: RUN_TIMEOUT_MS,
        logFile: p.vmLog,
      });
      expect(result.outcome, result.output).toBe('passed');
      expect(result.exitCode).toBe(0);
      return result.output;
    }

    beforeAll(async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-real-'));
      home = path.join(root, 'home');
      scripts = path.join(root, 'scripts');
      await fs.mkdir(scripts);
      await ensureHome({ home }, () => {});
      vm = path.join(cuisDistDir(home, CUIS_KEY), CUIS_VM_PATH);
      for (const name of ['probe', 'a', 'b']) await createInstance({ home, name });
      distBefore = await snapshot(cuisDistDir(home, CUIS_KEY));
      baseBefore = await snapshot(cuisBaseDir(home, CUIS_KEY));
    }, PREPARE_TIMEOUT_MS);

    afterAll(async () => {
      if (root) await fs.rm(root, { recursive: true, force: true });
    });

    it('prepares the home with the pinned download', async () => {
      await fs.access(vm);
      expect(distBefore.some((l) => l.startsWith('Packages/Features/JSON.pck.st '))).toBe(true);
      expect(baseBefore.some((l) => l.startsWith('Cuis7.8.image '))).toBe(true);
    });

    it('8: user folders land under files/ and UserChanges gains the change log', async () => {
      const p = instancePaths(home, 'probe');
      const out = await run('probe', 'folders', USER_FOLDERS_SCRIPT);
      const files = await fs.realpath(p.files);
      // Output lines carry a timestamp prefix; each user folder is printed as `name=/abs/path`.
      const printed = [...out.matchAll(/\b(?:userChanges|fileOuts|logs|savedChangeSets|newPackages|userBase)=(\/\S*)/g)].map((m) => m[1]!);
      expect(printed.length).toBe(6);
      for (const dir of printed) expect(`${dir}/`.startsWith(`${files}/`), dir).toBe(true);
      const userChanges = await fs.readdir(path.join(p.files, 'UserChanges'));
      expect(userChanges.some((f) => f.endsWith('.changes'))).toBe(true);
    }, TEST_TIMEOUT_MS);

    it('9: Packages and CoreUpdates resolve and the bridge package installs', async () => {
      const out = await run('probe', 'links', LINKS_SCRIPT(BRIDGE_PACKAGE));
      expect(out).toContain('coreUpdatesDirectory exists true');
      expect(out).toContain('packagesDirectory exists true');
      expect(out).toContain('bridge defined true');
    }, TEST_TIMEOUT_MS);

    it('10: saving a shipped package copies it on write; the other instance is unaffected', async () => {
      const shared = path.join(cuisDistDir(home, CUIS_KEY), 'Packages', 'Features', 'JSON.pck.st');
      const sharedBefore = createHash('sha256').update(await fs.readFile(shared)).digest('hex');
      await run('a', 'save-json', A_SAVE_JSON_SCRIPT);
      const aJson = instancePaths(home, 'a').packages + '/Features/JSON.pck.st';
      expect((await fs.lstat(aJson)).isFile()).toBe(true);
      expect(await fs.readFile(aJson, 'utf8')).toContain('probeFromA');
      expect(createHash('sha256').update(await fs.readFile(shared)).digest('hex')).toBe(sharedBefore);
      const out = await run('b', 'load-json', B_LOAD_JSON_SCRIPT);
      expect(out).toContain('hasProbeFromA false');
    }, TEST_TIMEOUT_MS);

    it('11: a package saved in A to NewPackages is required by B', async () => {
      await run('a', 'save-shared', A_SAVE_SHARED_SCRIPT);
      await fs.access(path.join(instancePaths(home, 'a').files, 'NewPackages', 'ProbeShared.pck.st'));
      const out = await run('b', 'require-shared', B_REQUIRE_SHARED_SCRIPT);
      expect(out).toContain('answer=42');
    }, TEST_TIMEOUT_MS);


    // ---- Part 02 lifecycle (start / stop) on real VMs. Each test uses its own fresh instance. ----
    // The GUI start opens a real window on the developer's desktop; it needs the extra opt-in
    // CUISCTL_REAL_GUI=1 (deliberate deviation from the spec, which runs it by default).
    describe('lifecycle', () => {
      let seq = 0;
      const created: Array<{ home: string; name: string }> = [];

      async function fresh(prefix: string, inHome = home): Promise<string> {
        const name = `${prefix}${++seq}`;
        await createInstance({ home: inHome, name });
        created.push({ home: inHome, name });
        return name;
      }

      const startOpts = (name: string, extra: Record<string, unknown> = {}, inHome = home) => ({
        home: inHome,
        name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: START_TIMEOUT_MS,
        ...extra,
      });

      async function start(name: string, extra: Record<string, unknown> = {}, inHome = home) {
        return runStart(startOpts(name, extra, inHome) as Parameters<typeof runStart>[0]);
      }
      async function stop(name: string, save = false, inHome = home) {
        return runStop({ home: inHome, name, save });
      }
      function okData<T>(result: Awaited<ReturnType<typeof runStart>>): T {
        expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
        return (result as { data: T }).data;
      }

      async function freePort(): Promise<number> {
        return new Promise((resolve, reject) => {
          const server = net.createServer();
          server.once('error', reject);
          server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as net.AddressInfo;
            server.close(() => resolve(port));
          });
        });
      }

      async function listeners(pid: number, port: number): Promise<number> {
        try {
          const { stdout } = await execFileP('lsof', ['-nP', '-a', '-p', String(pid), `-iTCP:${port}`, '-sTCP:LISTEN']);
          return stdout.trim().split('\n').filter((l) => l.length > 0).length - 1; // minus header
        } catch (e) {
          if ((e as { code?: unknown }).code === 1) return 0;
          throw e;
        }
      }

      const sha = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');

      /** Newline-delimited JSON request/response over one TCP connection. */
      async function bridgeSession(port: number, requests: object[]): Promise<Array<{ ok: boolean; result?: unknown }>> {
        let lastError: unknown;
        for (let attempt = 0; attempt < 20; attempt++) {
          try {
            return await new Promise((resolve, reject) => {
              const socket = net.connect(port, '127.0.0.1');
              const replies: Array<{ ok: boolean; result?: unknown }> = [];
              let buffer = '';
              const timer = setTimeout(() => {
                socket.destroy();
                reject(new Error('bridge session timed out'));
              }, 20_000);
              const next = () => socket.write(JSON.stringify(requests[replies.length]) + '\n');
              socket.on('connect', next);
              socket.on('error', (e) => {
                clearTimeout(timer);
                reject(e);
              });
              socket.on('data', (chunk) => {
                buffer += chunk.toString();
                let nl: number;
                while ((nl = buffer.indexOf('\n')) !== -1) {
                  replies.push(JSON.parse(buffer.slice(0, nl)));
                  buffer = buffer.slice(nl + 1);
                  if (replies.length === requests.length) {
                    clearTimeout(timer);
                    socket.destroy();
                    resolve(replies);
                    return;
                  }
                  next();
                }
              });
            });
          } catch (e) {
            lastError = e;
            await sleep(500);
          }
        }
        throw lastError;
      }

      /** Boots the instance image with a custom script, waits for it to exit (SIGTERM saves it). */
      async function bootOnce(
        name: string,
        script: string,
        { termWhen, termAfterMs = 0, inHome = home }: { termWhen?: () => Promise<boolean>; termAfterMs?: number; inHome?: string } = {},
      ): Promise<number | null> {
        const p = instancePaths(inHome, name);
        const file = path.join(scripts, `${name}-boot.st`);
        await fs.writeFile(file, script);
        const { pid, exited } = await spawnVm({
          vm: path.join(cuisDistDir(inHome, CUIS_KEY), CUIS_VM_PATH),
          image: p.image,
          script: file,
          cwd: p.files,
          logFile: p.vmLog,
          headless: true,
        });
        const watchdog = setTimeout(() => process.kill(pid, 'SIGKILL'), 90_000);
        try {
          if (termWhen) {
            const deadline = Date.now() + 60_000;
            while (!(await termWhen()) && Date.now() < deadline) await sleep(300);
          }
          await sleep(termAfterMs);
          process.kill(pid, 'SIGTERM');
          return await exited;
        } finally {
          clearTimeout(watchdog);
        }
      }

      const TRAP = `CodePackageFile installPackage: '${signalTrapPackageFile()}' asFullFileEntry.\n`;
      const WAIT_FOREVER = '1 to: 600 do: [ :i | (Delay forSeconds: 1) wait ].\n';

      async function killAll(): Promise<void> {
        for (const { home: h, name } of created) {
          for (const pid of await pidsHoldingFile(instancePaths(h, name).changes).catch(() => [])) {
            try {
              process.kill(pid, 'SIGKILL');
            } catch {
              // already gone
            }
          }
        }
      }
      afterEach(killAll);
      afterAll(killAll);

      /** Starts with the bridge and stops saving: an image saved with a running bridge. */
      async function savedWithBridge(name: string, port: number) {
        okData<StartView>(await start(name, { bridge: true, port }));
        expect(okData<StopView>(await stop(name, true))).toMatchObject({ outcome: 'stopped', saved: true });
      }

      it('1: start --headless reaches running (mode headless, no bridge); stop plain stops it', async () => {
        const name = await fresh('hl');
        const view = okData<StartView>(await start(name));
        expect(view).toMatchObject({ state: 'running', mode: 'headless', bridge: false, alreadyRunning: false });
        expect(await pidsHoldingFile(instancePaths(home, name).changes)).toContain(view.pid);
        expect(okData<StopView>(await stop(name))).toMatchObject({ outcome: 'stopped', saved: false });
        expect(okData<{ state: string }>(await runStatus({ home, name }))).toMatchObject({ state: 'stopped' });
        expect(await pidsHoldingFile(instancePaths(home, name).changes)).toEqual([]);
      }, LIFECYCLE_TIMEOUT_MS);

      // Opens a real window on the desktop: extra opt-in CUISCTL_REAL_GUI=1.
      it.skipIf(process.env.CUISCTL_REAL_GUI !== '1')(
        '1 (GUI): start without --headless reaches running with mode gui',
        async () => {
          const name = await fresh('gui');
          const view = okData<StartView>(await start(name, { headless: false }));
          expect(view).toMatchObject({ state: 'running', mode: 'gui', bridge: false });
          expect(okData<StopView>(await stop(name))).toMatchObject({ outcome: 'stopped' });
        },
        LIFECYCLE_TIMEOUT_MS,
      );

      it('1/21: start --bridge loads McpBridgeServer; handshake and list_categories succeed', async () => {
        const name = await fresh('br');
        const port = await freePort();
        const view = okData<StartView>(await start(name, { bridge: true, port }));
        expect(view).toMatchObject({ state: 'running', mode: 'headless', bridge: true });
        expect(await listeners(view.pid!, port)).toBe(1);
        const version = Number(/PROTOCOL_VERSION\s*=\s*(\d+)/.exec(await fs.readFile(PROTOCOL_FILE, 'utf8'))?.[1]);
        expect(version).toBeGreaterThan(0);
        const [handshake, categories] = await bridgeSession(port, [
          { op: 'handshake', params: { protocol_version: version } },
          { op: 'list_categories', params: {} },
        ]);
        expect(handshake).toMatchObject({ ok: true, result: { protocol_version: version } });
        expect(categories).toMatchObject({ ok: true });
        expect(categories!.result).toContain('MCP-Bridge');
        okData<StopView>(await stop(name));
      }, LIFECYCLE_TIMEOUT_MS);

      it('8: bridge, stop --save, bridge again: exactly one listener now and after 12 s', async () => {
        const name = await fresh('resume');
        const port = await freePort();
        await savedWithBridge(name, port);
        const view = okData<StartView>(await start(name, { bridge: true, port }));
        expect(await listeners(view.pid!, port)).toBe(1);
        await sleep(12_000);
        expect(await listeners(view.pid!, port)).toBe(1);
        okData<StopView>(await stop(name));
      }, LIFECYCLE_TIMEOUT_MS);

      it('9: image saved with a running bridge, started without --bridge: no listener now or after 12 s', async () => {
        const name = await fresh('nobridge');
        const port = await freePort();
        await savedWithBridge(name, port);
        const view = okData<StartView>(await start(name, { port }));
        expect(view.bridge).toBe(false);
        expect(await listeners(view.pid!, port)).toBe(0);
        await sleep(12_000);
        expect(await listeners(view.pid!, port)).toBe(0);
        okData<StopView>(await stop(name));
      }, LIFECYCLE_TIMEOUT_MS);

      it('12 and 22: stop --save on an idle armed instance saves; plain stop leaves the image unchanged', async () => {
        const name = await fresh('save');
        const p = instancePaths(home, name);
        const original = await sha(p.image);
        okData<StartView>(await start(name));
        okData<StopView>(await stop(name));
        expect(await sha(p.image)).toBe(original); // 22: plain stop
        const view = okData<StartView>(await start(name));
        expect(view.saveOnStop).toBe(true);
        expect(okData<StopView>(await stop(name, true))).toMatchObject({ outcome: 'stopped', saved: true });
        expect(await sha(p.image)).not.toBe(original);
      }, LIFECYCLE_TIMEOUT_MS);

      it('13: a forked ticker saved in the image keeps ticking across start and stop --save', async () => {
        const name = await fresh('ticker');
        const p = instancePaths(home, name);
        const tick = path.join(p.files, 'tick');
        const lines = async () => (await fs.readFile(tick, 'utf8').catch(() => '')).split('\n').filter(Boolean).length;
        const script =
          HEAD +
          TRAP +
          `[ [ '${tick}' asFullFileEntry appendStreamDo: [ :s | s nextPutAll: 'tick'; newLine ]. (Delay forSeconds: 1) wait ] repeat ] forkAt: Processor userBackgroundPriority.\n` +
          WAIT_FOREVER;
        expect(await bootOnce(name, script, { termWhen: async () => (await lines()) >= 2 })).toBe(0);
        const grows = async (label: string) => {
          const before = await lines();
          await sleep(4000);
          expect(await lines(), label).toBeGreaterThan(before);
        };
        okData<StartView>(await start(name));
        await grows('after first start');
        expect(okData<StopView>(await stop(name, true))).toMatchObject({ saved: true });
        okData<StartView>(await start(name));
        await grows('after stop --save and start');
        okData<StopView>(await stop(name));
      }, LIFECYCLE_TIMEOUT_MS);

      it('3 and 22: an image saved with a busy forked loop at priority 40 gives start_failed; image unchanged', async () => {
        const name = await fresh('busy');
        const p = instancePaths(home, name);
        const marker = path.join(p.files, 'busy-started');
        const script =
          HEAD +
          TRAP +
          `[ [ true ] whileTrue: [ 3 + 4 ] ] forkAt: 40.\n'${marker}' asFullFileEntry forceWriteStreamDo: [ :s | s nextPutAll: 'x' ].\n` +
          WAIT_FOREVER;
        const exists = () => fs.access(marker).then(() => true, () => false);
        expect(await bootOnce(name, script, { termWhen: exists, termAfterMs: 2000 })).toBe(0);
        const saved = await sha(p.image);
        const result = await start(name, { startTimeoutMs: 8000 });
        expect(result).toMatchObject({ ok: false, error: { kind: 'start_failed' } });
        expect(await pidsHoldingFile(p.changes)).toEqual([]);
        expect(okData<{ state: string }>(await runStatus({ home, name }))).toMatchObject({ state: 'stopped' });
        await expect(fs.access(p.runRecord)).rejects.toThrow();
        expect(await sha(p.image)).toBe(saved);
      }, LIFECYCLE_TIMEOUT_MS);

      it('16: a method compiled in a started instance stays in UserChanges after plain stop', async () => {
        const name = await fresh('compile');
        const p = instancePaths(home, name);
        const go = path.join(p.files, 'go');
        const done = path.join(p.files, 'compiled');
        // Saved forked process: waits for files/go, then compiles a method (in the started session).
        const script =
          HEAD +
          TRAP +
          `[ [ '${go}' asFullFileEntry exists ] whileFalse: [ (Delay forSeconds: 1) wait ].\n` +
          `Utilities setAuthorName: 'Test' initials: 'tst'.\n` +
          `Object compile: 'probeItem16 ^16' classified: 'probe'.\n` +
          `'${done}' asFullFileEntry forceWriteStreamDo: [ :s | s nextPutAll: 'x' ] ] forkAt: Processor userBackgroundPriority.\n` +
          WAIT_FOREVER;
        expect(await bootOnce(name, script, { termAfterMs: 4000 })).toBe(0);
        okData<StartView>(await start(name));
        await fs.writeFile(go, 'go');
        const deadline = Date.now() + 30_000;
        while (!(await fs.access(done).then(() => true, () => false)) && Date.now() < deadline) await sleep(300);
        await fs.access(done);
        okData<StopView>(await stop(name));
        const dir = path.join(p.files, 'UserChanges');
        const logs = (await fs.readdir(dir)).filter((f) => f.endsWith('.user.changes'));
        expect(logs.length).toBeGreaterThan(0);
        const texts = await Promise.all(logs.map((f) => fs.readFile(path.join(dir, f), 'utf8')));
        expect(texts.some((t) => t.includes('probeItem16'))).toBe(true);
      }, LIFECYCLE_TIMEOUT_MS);

      it('17: a VM without UnixOSProcessPlugin starts unarmed; stop --save gives not_saved', async () => {
        const home2 = path.join(root, 'home-noplugin');
        await fs.mkdir(home2, { recursive: true });
        await fs.cp(cuisKeyDir(home, CUIS_KEY), cuisKeyDir(home2, CUIS_KEY), { recursive: true, verbatimSymlinks: true });
        const { stdout } = await execFileP('find', [cuisDistDir(home2, CUIS_KEY), '-name', 'UnixOSProcessPlugin.bundle']);
        const bundles = stdout.split('\n').filter(Boolean);
        expect(bundles.length).toBeGreaterThan(0);
        for (const b of bundles) await fs.rm(b, { recursive: true, force: true });
        await ensureHome({ home: home2 }, () => {});
        const name = await fresh('noplugin', home2);
        const view = okData<StartView>(await start(name, {}, home2));
        expect(view.saveOnStop).toBe(false);
        expect(JSON.parse(await fs.readFile(instancePaths(home2, name).runRecord, 'utf8'))).toMatchObject({ saveOnStop: false });
        expect(await fs.readFile(instancePaths(home2, name).readyFile, 'utf8')).toContain('armed=false');
        const status = await runStatus({ home: home2, name });
        expect(renderText(status)).toContain('save on stop: unavailable');
        const result = await stop(name, true, home2);
        expect(result).toMatchObject({ ok: false, error: { kind: 'not_saved' } });
        expect(JSON.stringify(result)).toContain('save on stop unavailable');
        expect(await pidsHoldingFile(instancePaths(home2, name).changes)).toEqual([]);
      }, LIFECYCLE_TIMEOUT_MS);

      // ---- Part 03 cleanup (reset / destroy) on real VMs. ----
      it('reset 1: a saved compiled method is gone after reset; UserChanges keeps the change log', async () => {
        const name = await fresh('reset');
        const p = instancePaths(home, name);
        // Saved through the SIGTERM trap (the same save path as stop --save), as tests 3 and 13 do.
        const script =
          HEAD + TRAP + "Object compile: 'probeResetItem ^1' classified: 'probe'.\n" + WAIT_FOREVER;
        expect(await bootOnce(name, script, { termAfterMs: 4000 })).toBe(0);
        const probe = HEAD + show("'has=', (Object includesSelector: #probeResetItem) printString") + TAIL;
        expect(await run(name, 'before-reset', probe)).toContain('has=true');
        const userChanges = path.join(p.files, 'UserChanges');
        const readLogs = async () => {
          const logs = (await fs.readdir(userChanges)).filter((f) => f.endsWith('.changes'));
          return Promise.all(logs.map((f) => fs.readFile(path.join(userChanges, f), 'utf8')));
        };
        const logsBefore = await readLogs();
        expect(logsBefore.some((t) => t.includes('probeResetItem'))).toBe(true);

        expect(await runReset({ home, name })).toMatchObject({ ok: true });
        const view = okData<StartView>(await start(name));
        expect(view.state).toBe('running');
        okData<StopView>(await stop(name));
        expect(await run(name, 'after-reset', probe)).toContain('has=false');
        const logsAfter = await readLogs();
        expect(logsAfter.length).toBeGreaterThan(0);
        expect(logsAfter.some((t) => t.includes('probeResetItem'))).toBe(true);
      }, LIFECYCLE_TIMEOUT_MS);

      it('reset 3: a busy-loop image fails start_failed; after reset the instance starts and stops', async () => {
        const name = await fresh('busyreset');
        const p = instancePaths(home, name);
        const marker = path.join(p.files, 'busy-started');
        const script =
          HEAD +
          TRAP +
          `[ [ true ] whileTrue: [ 3 + 4 ] ] forkAt: 40.\n'${marker}' asFullFileEntry forceWriteStreamDo: [ :s | s nextPutAll: 'x' ].\n` +
          WAIT_FOREVER;
        const exists = () => fs.access(marker).then(() => true, () => false);
        expect(await bootOnce(name, script, { termWhen: exists, termAfterMs: 2000 })).toBe(0);
        expect(await start(name, { startTimeoutMs: 8000 })).toMatchObject({ ok: false, error: { kind: 'start_failed' } });
        expect(await pidsHoldingFile(p.changes)).toEqual([]);
        expect(await runReset({ home, name })).toMatchObject({ ok: true });
        const view = okData<StartView>(await start(name));
        expect(view.state).toBe('running');
        expect(okData<StopView>(await stop(name))).toMatchObject({ outcome: 'stopped' });
        expect(await pidsHoldingFile(p.changes)).toEqual([]);
      }, LIFECYCLE_TIMEOUT_MS);

      it('destroy: removes the instance directory, leaves cuis/<key> untouched; status says not_found', async () => {
        const name = await fresh('destroy');
        const p = instancePaths(home, name);
        okData<StartView>(await start(name));
        okData<StopView>(await stop(name));
        await fs.access(p.dir);
        const dist = await snapshot(cuisDistDir(home, CUIS_KEY));
        const base = await snapshot(cuisBaseDir(home, CUIS_KEY));
        expect(await runDestroy({ home, name, yes: true })).toMatchObject({ ok: true });
        await expect(fs.access(p.dir)).rejects.toThrow();
        expect(await snapshot(cuisDistDir(home, CUIS_KEY))).toEqual(dist);
        expect(await snapshot(cuisBaseDir(home, CUIS_KEY))).toEqual(base);
        expect(dist).toEqual(distBefore);
        expect(base).toEqual(baseBefore);
        expect(await runStatus({ home, name })).toMatchObject({ ok: false, error: { kind: 'not_found' } });
      }, LIFECYCLE_TIMEOUT_MS);

      it('has no stray VM left over', async () => {
        await killAll();
        for (const { home: h, name } of created) expect(await pidsHoldingFile(instancePaths(h, name).changes)).toEqual([]);
        expect((await listInstances(home)).length).toBeGreaterThan(0);
      });
    });

    it('leaves the home dist/ and base/ unchanged', async () => {
      expect(await snapshot(cuisDistDir(home, CUIS_KEY))).toEqual(distBefore);
      expect(await snapshot(cuisBaseDir(home, CUIS_KEY))).toEqual(baseBefore);
    });
  },
);
