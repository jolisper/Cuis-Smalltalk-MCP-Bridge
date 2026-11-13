import net from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { bridgeAnswers, listenerPids, listensOnLoopbackOnly, portInUse } from './portCheck.js';

describe('cuisctl portCheck', () => {
  it('listenerPids includes this process pid when it listens on 127.0.0.1 at that port', async () => {
    // Given
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;

    try {
      // When
      const pids = await listenerPids(port);

      // Then
      expect(pids).toContain(process.pid);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('listenerPids resolves an empty array when nothing listens on that port', async () => {
    // Given
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    // When
    const pids = await listenerPids(port);

    // Then
    expect(pids).toEqual([]);
  });

  it('portInUse resolves true when a server listens on 127.0.0.1 at that port', async () => {
    // Given
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;

    try {
      // When
      const inUse = await portInUse(port);

      // Then
      expect(inUse).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('portInUse resolves false when nothing listens on 127.0.0.1 at that port', async () => {
    // Given
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    // When
    const inUse = await portInUse(port);

    // Then
    expect(inUse).toBe(false);
  }, 5000);

  it('portInUse resolves true when a connect attempt neither connects nor errors within 1000 ms', async () => {
    // Given
    vi.useFakeTimers();
    const connectSpy = vi.spyOn(net, 'connect').mockImplementation(() => new net.Socket());

    try {
      // When
      const pending = portInUse(54321);
      await vi.advanceTimersByTimeAsync(1000);

      // Then
      await expect(pending).resolves.toBe(true);
    } finally {
      connectSpy.mockRestore();
      vi.useRealTimers();
    }
  }, 5000);

  it('portInUse resolves true when a server listens only on ::1 at that port', async (ctx) => {
    // Given
    const server = net.createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '::1', resolve);
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT') {
        ctx.skip();
      }
      throw error;
    }
    const { port } = server.address() as net.AddressInfo;

    try {
      // When
      const inUse = await portInUse(port);

      // Then
      expect(inUse).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 5000);

  it.for(['0.0.0.0', '::'])('portInUse resolves true when a server listens on %s at that port', { timeout: 5000 }, async (host, ctx) => {
    // Given
    const server = net.createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, host, resolve);
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT') {
        ctx.skip();
      }
      throw error;
    }
    const { port } = server.address() as net.AddressInfo;

    try {
      // When
      const inUse = await portInUse(port);

      // Then
      expect(inUse).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('listensOnLoopbackOnly is true for a 127.0.0.1 listener, false for a 0.0.0.0 listener and false when nothing listens', async () => {
    // Given
    const loopback = net.createServer();
    await new Promise<void>((resolve) => loopback.listen(0, '127.0.0.1', resolve));
    const loopbackPort = (loopback.address() as net.AddressInfo).port;
    const wildcard = net.createServer();
    await new Promise<void>((resolve) => wildcard.listen(0, '0.0.0.0', resolve));
    const wildcardPort = (wildcard.address() as net.AddressInfo).port;
    const idle = net.createServer();
    await new Promise<void>((resolve) => idle.listen(0, '127.0.0.1', resolve));
    const idlePort = (idle.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => idle.close(() => resolve()));

    try {
      // When
      const onLoopback = await listensOnLoopbackOnly(process.pid, loopbackPort);
      const onWildcard = await listensOnLoopbackOnly(process.pid, wildcardPort);
      const onNothing = await listensOnLoopbackOnly(process.pid, idlePort);

      // Then
      expect(onLoopback).toBe(true);
      expect(onWildcard).toBe(false);
      expect(onNothing).toBe(false);
    } finally {
      await new Promise<void>((resolve) => loopback.close(() => resolve()));
      await new Promise<void>((resolve) => wildcard.close(() => resolve()));
    }
  }, 10000);

  it('bridgeAnswers sends the handshake line and resolves true on a protocol_mismatch reply', async () => {
    // Given
    const received: string[] = [];
    const server = net.createServer((socket) => {
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        const newline = buffer.indexOf('\n');
        if (newline !== -1) {
          received.push(buffer.slice(0, newline));
          socket.write('{"ok":false,"error":{"code":"protocol_mismatch"}}\n');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;

    try {
      // When
      const answers = await bridgeAnswers(port, 1000);

      // Then
      expect(answers).toBe(true);
      expect(JSON.parse(received[0])).toEqual({ op: 'handshake', params: { protocol_version: 0 } });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 5000);

  it('bridgeAnswers resolves false when the reply is not JSON', async () => {
    // Given
    const server = net.createServer((socket) => {
      socket.on('data', () => {
        socket.write('not json\n');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;

    try {
      // When
      const answers = await bridgeAnswers(port, 1000);

      // Then
      expect(answers).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 5000);

  it('bridgeAnswers resolves false after the timeout when the server never replies', async () => {
    // Given
    const sockets: net.Socket[] = [];
    const server = net.createServer((socket) => {
      sockets.push(socket);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;

    try {
      // When
      const start = Date.now();
      const answers = await bridgeAnswers(port, 200);
      const elapsed = Date.now() - start;

      // Then
      expect(answers).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(190);
      expect(elapsed).toBeLessThan(2000);
    } finally {
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 5000);

  it('bridgeAnswers resolves false quickly when nothing listens on that port', async () => {
    // Given
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    // When
    const start = Date.now();
    const answers = await bridgeAnswers(port, 1000);
    const elapsed = Date.now() - start;

    // Then
    expect(answers).toBe(false);
    expect(elapsed).toBeLessThan(800);
  }, 5000);
});
