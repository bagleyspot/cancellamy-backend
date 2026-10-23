import { isIP } from 'net';
import { lookup } from 'dns/promises';

/** True for addresses that must never be reachable from a user-supplied host (SSRF protection). */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped ? (mapped[1] as string) : address;
  const version = isIP(ip);
  if (version === 4) {
    const [a, b, c] = ip.split('.').map(Number) as [number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      /^fe[89ab]/.test(lower) ||
      lower.startsWith('ff')
    );
  }
  return true; // not an IP: callers must resolve first
}

export class HostNotAllowedError extends Error {}

/**
 * Resolves a host once and returns a public address to connect to. Connecting to the returned IP (instead of
 * the name) prevents DNS-rebinding between the check and the connection.
 */
export async function resolvePublicHost(host: string): Promise<string> {
  const trimmed = host.trim();
  if (!trimmed || trimmed.length > 253) throw new HostNotAllowedError('Invalid host');
  if (isIP(trimmed)) {
    if (isPrivateAddress(trimmed)) throw new HostNotAllowedError('Private addresses are not allowed');
    return trimmed;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(trimmed, { all: true });
  } catch {
    throw new HostNotAllowedError('Host not found');
  }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new HostNotAllowedError('Private addresses are not allowed');
  }
  return (addresses[0] as { address: string }).address;
}
