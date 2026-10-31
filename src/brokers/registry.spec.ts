import { join } from 'path';
import { defaultSendEnabled, loadRegistryFile, parseMarkets, parseRegistry } from './registry';

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

  it('reads the markets and whether a contact was read on the official site', () => {
    const [a, b, c] = parseRegistry(
      [
        'entries:',
        '  - {id: a, name: A, category: other, markets: [it, IT, All]}',
        '  - id: b',
        '    name: B',
        '    category: other',
        '    provenance:',
        '      - {stream: B, ref: x, license: CC0-1.0}',
        '      - {stream: G, ref: https://b.example/privacy, license: own-research, verified_on_official_site: true}',
        '  - {id: c, name: C, category: other, provenance: [{stream: B, ref: x, license: CC0-1.0}]}',
      ].join('\n'),
    );
    expect(a).toMatchObject({ markets: ['IT', 'ALL'], officialSiteVerified: false });
    expect(b).toMatchObject({ markets: [], officialSiteVerified: true });
    expect(c?.officialSiteVerified).toBe(false);
  });

  it('splits comma separated markets and ignores "unknown"', () => {
    expect(parseMarkets(['DE,AT, ch', 'unknown', 'de'])).toEqual(['DE', 'AT', 'CH']);
    expect(parseMarkets(undefined)).toEqual([]);
  });

  it('shipped entries that declare markets use ISO codes or ALL / EU / EEA', () => {
    for (const e of real) for (const m of e.markets) expect(m).toMatch(/^([A-Z]{2}|ALL|EU|EEA|GLOBAL)$/);
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
