// Long-running fake VM. Invoked as: node fakeRunningVm.mjs [-headless] <image> -s <script> [...]
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const args = process.argv.slice(2);
const image = args.find((a) => !a.startsWith('-'));
const script = args[args.indexOf('-s') + 1];
const dir = path.dirname(image);

let config = {};
try {
  config = JSON.parse(fs.readFileSync(path.join(dir, 'fake-vm.json'), 'utf8'));
} catch {}

// Held open for the process lifetime so lsof sees it.
fs.openSync(image.replace(/\.image$/, '.changes'), 'a+');

const text = fs.readFileSync(script, 'utf8');
const readyFile = /"cuisctl-ready: ([^"]*)"/.exec(text)?.[1];
const portMarker = /"cuisctl-bridge-port: (\w+)"/.exec(text)?.[1] ?? 'none';

const armed = config.armed !== false;

const signalsLog = path.join(dir, 'signals.log');
for (const sig of ['SIGTERM', 'SIGHUP', 'SIGINT']) {
  if (sig === 'SIGTERM' && !armed) {
    // Default death (image untouched), but observable: log, then re-kill with the default action.
    process.on('SIGTERM', () => {
      fs.appendFileSync(signalsLog, 'SIGTERM\n');
      process.removeAllListeners('SIGTERM');
      process.kill(process.pid, 'SIGTERM');
    });
    continue;
  }
  process.on(sig, () => {
    fs.appendFileSync(signalsLog, sig + '\n');
    if (sig === 'SIGTERM') onTerm();
  });
}

function onTerm() {
  const mode = config.onTerm ?? 'save';
  if (mode === 'ignore') return;
  if (mode === 'slowSave') {
    const total = config.slowSaveMs ?? 2000;
    const start = Date.now();
    const timer = setInterval(() => {
      fs.appendFileSync(image, 'slow-save-step\n');
      if (Date.now() - start >= total) {
        clearInterval(timer);
        process.exit(0);
      }
    }, 100);
    return;
  }
  fs.appendFileSync(image, 'saved\n');
  process.exit(0);
}

if (config.exitEarly) {
  console.log('fake VM: exiting early');
  process.exit(1);
}

const wantBridge = portMarker !== 'none' && config.bridge !== false;

function listen() {
  return new Promise((resolve, reject) => {
    const server = net.createServer((sock) => {
      let buf = '';
      sock.on('data', (d) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          buf = buf.slice(i + 1);
          sock.write(JSON.stringify({ ok: true, result: {} }) + '\n');
        }
      });
      sock.on('error', () => {});
    });
    server.on('error', reject);
    server.listen(Number(portMarker), config.bridgeHost ?? '127.0.0.1', () => resolve());
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!config.neverReady) {
  await sleep(config.readyDelayMs ?? 0);
  if (wantBridge) {
    await sleep(config.bridgeDelayMs ?? 0);
    await listen();
  }
  if (readyFile) fs.writeFileSync(readyFile, `armed=${armed}`);
  console.log('fake VM: ready');
} else {
  console.log('fake VM: never ready');
}

setInterval(() => {}, 1000);
