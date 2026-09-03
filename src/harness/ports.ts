import { createConnection, createServer } from "node:net";
import { createSocket } from "node:dgram";

export const STATIC_TESTNET_PORTS = {
  dht: 6881,
  pkarr: 15411,
  httpRelay: 15412,
  admin: 6288,
} as const;

function canBindTcp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    const done = (ok: boolean) => {
      server.removeAllListeners();
      try {
        server.close();
      } catch {
        // ignore
      }
      resolve(ok);
    };
    server.once("error", () => done(false));
    server.listen(port, "0.0.0.0", () => done(true));
  });
}

function canBindUdp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createSocket("udp4");
    const done = (ok: boolean) => {
      sock.removeAllListeners();
      try {
        sock.close();
      } catch {
        // ignore
      }
      resolve(ok);
    };
    sock.once("error", () => done(false));
    sock.bind(port, () => done(true));
  });
}

export async function probeStaticTestnetPorts(): Promise<{
  free: boolean;
  blocked: string[];
}> {
  const blocked: string[] = [];
  if (!(await canBindUdp(STATIC_TESTNET_PORTS.dht))) blocked.push("udp/6881");
  if (!(await canBindTcp(STATIC_TESTNET_PORTS.dht))) blocked.push("tcp/6881");
  if (!(await canBindTcp(STATIC_TESTNET_PORTS.pkarr))) blocked.push("tcp/15411");
  if (!(await canBindTcp(STATIC_TESTNET_PORTS.httpRelay))) blocked.push("tcp/15412");
  if (!(await canBindTcp(STATIC_TESTNET_PORTS.admin))) blocked.push("tcp/6288");
  return { free: blocked.length === 0, blocked };
}

export async function canConnectTcp(host: string, port: number, timeoutMs = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const c = createConnection({ host, port });
    const finish = (ok: boolean) => {
      c.removeAllListeners();
      c.destroy();
      resolve(ok);
    };
    c.setTimeout(timeoutMs, () => finish(false));
    c.once("connect", () => finish(true));
    c.once("error", () => finish(false));
  });
}
