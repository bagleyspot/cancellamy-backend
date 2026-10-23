import { CryptoService, randomToken, safeEqual, sha256 } from './crypto.service';
import { loadConfig } from '../config/app-config';

describe('CryptoService', () => {
  const service = new CryptoService(loadConfig({ NODE_ENV: 'test' }));

  it('round-trips text and JSON', () => {
    expect(service.decrypt(service.encrypt('Mario Rossi'))).toBe('Mario Rossi');
    expect(service.decryptJson<{ a: number }>(service.encryptJson({ a: 1 }))).toEqual({ a: 1 });
  });

  it('uses a random IV (same plaintext, different ciphertext)', () => {
    expect(service.encrypt('x')).not.toBe(service.encrypt('x'));
  });

  it('detects tampering', () => {
    const parts = service.encrypt('secret').split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => service.decrypt(parts.join(':'))).toThrow();
  });

  it('rejects unknown formats', () => {
    expect(() => service.decrypt('v9:a:b:c')).toThrow();
  });

  it('helpers behave', () => {
    expect(sha256('a')).toHaveLength(64);
    expect(randomToken()).not.toBe(randomToken());
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
