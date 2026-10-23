import { join } from 'path';
import { defaultSendEnabled, loadRegistryFile, parseRegistry } from './registry';

describe('registry', () => {
  const real = loadRegistryFile(join(__dirname, '..', '..', 'registry', 'brokers.yaml'));

  it('parses the shipped registry with unique ids', () => {
    expect(real.length).toBeGreaterThan(400);
    expect(new Set(real.map((e) => e.slug)).size).toBe(real.length);
  });

  it('only auto-enables verified entries with a usable channel, never excluded categories', () => {
    const enabled = real.filter(defaultSendEnabled);
    expect(enabled.length).toBeGreaterThan(10);
    for (const e of enabled) {
      expect(e.verificationStatus).toBe('verified');
      expect(['regulator', 'credit_bureau', 'kyc_pep', 'business_register', 'public_records']).not.toContain(e.category);
    }
  });

  it('rejects duplicates and incomplete entries', () => {
    expect(() => parseRegistry('entries:\n  - {id: a, name: A, category: other}\n  - {id: a, name: B, category: other}')).toThrow(/Duplicate/);
    expect(() => parseRegistry('entries:\n  - {id: a}')).toThrow(/missing/);
    expect(() => parseRegistry('foo: 1')).toThrow(/no entries/);
  });

  it('normalises unknown channel types to other and drops empty values', () => {
    const [e] = parseRegistry("entries:\n  - id: a\n    name: A\n    category: other\n    channels:\n      - {type: fax, value: '123'}\n      - {type: email, value: ''}");
    expect(e?.channels).toEqual([{ type: 'other', value: '123', label: undefined, verified: false }]);
  });
});
