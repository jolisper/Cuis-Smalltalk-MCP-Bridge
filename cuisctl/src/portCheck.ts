import { execFile } from 'node:child_process';
import net from 'node:net';
import { promisify } from 'node:util';

/**
 * Port probing helpers: who listens on a TCP port, whether the port is
 * occupied on loopback, and whether the occupant is an MCP bridge.
 */

const execFileP = promisify(execFile);

/** Connect errors meaning nothing is listening (the port is free). */
const FREE_ERROR_CODES = ['ECONNREFUSED', 'EADDRNOTAVAIL', 'ENETUNREACH', 'EAFNOSUPPORT'];

/** A connection that neither succeeds nor fails within this time counts as in use. */
const PROBE_TIMEOUT_MS = 1000;

const HANDSHAKE_REQUEST = '{"op":"handshake","params":{"protocol_version":0}}\n';

/** PIDs listening on the TCP port (via lsof); empty when none. */
export async function listenerPids(port: number): Promise<number[]> {
  try {
    const { stdout } = await execFileP('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN']);
    return stdout.trim().split('\n').map(Number);
  } catch (error) {
    const { code, stdout } = error as { code?: unknown; stdout?: string };
    if (code === 1 && stdout === '') return [];
    throw error;
  }
}

/** True when the process listens on the port and every listener is bound to 127.0.0.1 only. */
export async function listensOnLoopbackOnly(pid: number, port: number): Promise<boolean> {
  let stdout: string;
  try {
    ({ stdout } = await execFileP('lsof', ['-nP', '-a', '-p', String(pid), `-iTCP:${port}`, '-sTCP:LISTEN']));
  } catch (error) {
    const { code, stdout: out } = error as { code?: unknown; stdout?: string };
    if (code === 1 && out === '') return false;
    throw error;
  }
  const listeners = stdout.split('\n').slice(1).filter((line) => line.trim() !== '');
  return (
    listeners.length > 0 &&
    listeners.every((line) => new RegExp(`\\s127\\.0\\.0\\.1:${port}(\\s+\\(LISTEN\\))?\\s*$`).test(line))
  );
}

/** True unless a connection to host:port is refused or the address is unusable. */
function hostInUse(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(true);
    }, PROBE_TIMEOUT_MS);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(!FREE_ERROR_CODES.includes(error.code ?? ''));
    });
  });
}

/** True if 127.0.0.1:port replies to a bridge handshake with a JSON object carrying a boolean `ok`. */
export function bridgeAnswers(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.on('connect', () => {
      socket.write(HANDSHAKE_REQUEST);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      clearTimeout(timer);
      socket.destroy();
      try {
        const reply = JSON.parse(buffer.slice(0, newline));
        resolve(typeof reply === 'object' && reply !== null && typeof reply.ok === 'boolean');
      } catch {
        resolve(false);
      }
    });
  });
}

/** True if the port is in use on either IPv4 or IPv6 loopback. */
export async function portInUse(port: number): Promise<boolean> {
  const results = await Promise.all([hostInUse(port, '127.0.0.1'), hostInUse(port, '::1')]);
  return results.some(Boolean);
}
