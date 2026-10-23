import { buildTimestampRequest, readTimestampStatus } from './timestamp.service';

describe('RFC 3161 helpers', () => {
  it('builds a well-formed TimeStampReq for a SHA-256 digest', () => {
    const digest = 'ab'.repeat(32);
    const req = buildTimestampRequest(digest, Buffer.from('0102030405060708', 'hex'));
    expect(req[0]).toBe(0x30);
    expect(req.includes(Buffer.from(digest, 'hex'))).toBe(true);
    // sha-256 OID 2.16.840.1.101.3.4.2.1
    expect(req.includes(Buffer.from('0609608648016503040201', 'hex'))).toBe(true);
    // certReq = TRUE
    expect(req.subarray(req.length - 3).equals(Buffer.from('0101ff', 'hex'))).toBe(true);
  });

  it('rejects anything but a 32-byte digest and keeps the nonce positive', () => {
    expect(() => buildTimestampRequest('abcd')).toThrow();
    const req = buildTimestampRequest('00'.repeat(32), Buffer.from('ffffffffffffffff', 'hex'));
    const nonceAt = req.indexOf(Buffer.from('0208', 'hex'), 40);
    expect((req[nonceAt + 2] as number) & 0x80).toBe(0);
  });

  it('reads the PKIStatus of a response', () => {
    expect(readTimestampStatus(Buffer.from('3005300302010 0'.replace(' ', ''), 'hex'))).toBe(0);
    expect(readTimestampStatus(Buffer.from('300530030201 02'.replace(' ', ''), 'hex'))).toBe(2);
    expect(readTimestampStatus(Buffer.from('nonsense'))).toBeNull();
    expect(readTimestampStatus(Buffer.alloc(0))).toBeNull();
  });
});
