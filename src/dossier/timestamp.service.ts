import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';

const tlv = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts);
  const len = body.length;
  const header =
    len < 0x80 ? Buffer.from([tag, len]) : len < 0x100 ? Buffer.from([tag, 0x81, len]) : Buffer.from([tag, 0x82, len >> 8, len & 0xff]);
  return Buffer.concat([header, body]);
};

const OID_SHA256 = Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);

/** RFC 3161 TimeStampReq for a SHA-256 digest (DER). */
export function buildTimestampRequest(sha256Hex: string, nonce: Buffer = randomBytes(8)): Buffer {
  const digest = Buffer.from(sha256Hex, 'hex');
  if (digest.length !== 32) throw new Error('A SHA-256 digest is required');
  const n = Buffer.from(nonce);
  n[0] = (n[0] as number) & 0x7f || 0x01; // positive, non-zero first byte
  return tlv(
    0x30,
    tlv(0x02, Buffer.from([0x01])),
    tlv(0x30, tlv(0x30, OID_SHA256, Buffer.from([0x05, 0x00])), tlv(0x04, digest)),
    tlv(0x02, n),
    tlv(0x01, Buffer.from([0xff])),
  );
}

/** Reads PKIStatus of a TimeStampResp: 0 = granted, 1 = grantedWithMods. Returns null when it cannot be parsed. */
export function readTimestampStatus(reply: Buffer): number | null {
  const readLen = (buf: Buffer, at: number): { len: number; next: number } | null => {
    const first = buf[at];
    if (first === undefined) return null;
    if (first < 0x80) return { len: first, next: at + 1 };
    const count = first & 0x7f;
    let len = 0;
    for (let i = 0; i < count; i++) len = (len << 8) | (buf[at + 1 + i] ?? 0);
    return { len, next: at + 1 + count };
  };
  if (reply[0] !== 0x30) return null;
  const outer = readLen(reply, 1);
  if (!outer || reply[outer.next] !== 0x30) return null;
  const info = readLen(reply, outer.next + 1);
  if (!info || reply[info.next] !== 0x02) return null;
  const int = readLen(reply, info.next + 1);
  if (!int || int.len < 1) return null;
  return reply[int.next] ?? null;
}

@Injectable()
export class TimestampService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled(): boolean {
    return !!this.config.tsaUrl;
  }

  /** Asks the configured authority to timestamp a digest. Only the hash leaves the system. */
  async stamp(sha256Hex: string): Promise<Buffer> {
    const res = await fetch(this.config.tsaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query', Accept: 'application/timestamp-reply' },
      body: new Uint8Array(buildTimestampRequest(sha256Hex)),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`TSA answered ${res.status}`);
    const reply = Buffer.from(await res.arrayBuffer());
    const status = readTimestampStatus(reply);
    if (status !== 0 && status !== 1) throw new Error('TSA did not grant the timestamp');
    return reply;
  }
}
