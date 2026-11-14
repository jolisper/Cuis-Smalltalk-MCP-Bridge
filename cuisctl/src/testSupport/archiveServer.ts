import { promises as fs } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

export interface ArchiveServer {
  url: string;
  requestCount(): number;
  close(): Promise<void>;
}

export async function startArchiveServer(
  zipPath: string,
  opts: {
    behavior?: 'ok' | 'not-found' | 'reset-midstream' | 'http10-close';
    delayMs?: number;
    chunkSize?: number;
    chunkGapMs?: number;
  } = {},
): Promise<ArchiveServer> {
  const behavior = opts.behavior ?? 'ok';
  let requests = 0;

  if (behavior === 'http10-close') {
    // Like `python3 -m http.server`: HTTP/1.0, Content-Length, socket closed right after the body.
    const raw = net.createServer((socket) => {
      socket.on('error', () => {});
      socket.once('data', async () => {
        requests += 1;
        const body = await fs.readFile(zipPath);
        socket.write(
          `HTTP/1.0 200 OK\r\nContent-Type: application/zip\r\nContent-Length: ${body.length}\r\n\r\n`,
        );
        socket.end(body);
      });
    });
    await new Promise<void>((resolve) => raw.listen(0, '127.0.0.1', resolve));
    const { port } = raw.address() as AddressInfo;
    return {
      url: `http://127.0.0.1:${port}/archive.zip`,
      requestCount: () => requests,
      close: () =>
        new Promise<void>((resolve) => {
          raw.close(() => resolve());
          raw.unref();
        }),
    };
  }

  const server = http.createServer(async (req, res) => {
    requests += 1;
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (behavior === 'not-found') {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const body = await fs.readFile(zipPath);
    if (behavior === 'ok' && opts.chunkGapMs !== undefined) {
      const size = opts.chunkSize ?? 64 * 1024;
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': body.length });
      for (let i = 0; i < body.length && !res.destroyed; i += size) {
        res.write(body.subarray(i, i + size));
        await new Promise((r) => setTimeout(r, opts.chunkGapMs));
      }
      res.end();
      return;
    }
    if (behavior === 'ok') {
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': body.length });
      res.end(body);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': body.length });
    res.write(body.subarray(0, Math.floor(body.length / 2)), () => req.socket.destroy());
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/archive.zip`,
    requestCount: () => requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
