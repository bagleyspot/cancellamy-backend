import { classifyBroker, profileCountries, selectBrokersForProfile } from './relevance';

interface B {
  name: string;
  markets: string[];
  hqCountry?: string;
  officialSiteVerified: boolean;
}
const b = (name: string, markets: string[], extra: Partial<B> = {}): B => ({ name, markets, officialSiteVerified: false, ...extra });

describe('profileCountries', () => {
  it('uses the countries of the addresses, normalised and deduplicated', () => {
    expect(profileCountries([{ country: 'it' }, { country: 'IT' }, { country: 'uk' }])).toEqual(['IT', 'GB']);
  });
  it('falls back to Italy when there is no address country', () => {
    expect(profileCountries([])).toEqual(['IT']);
    expect(profileCountries([{ country: ' ' }])).toEqual(['IT']);
  });
});

describe('classifyBroker', () => {
  const italy = ['IT'];
  it.each([
    [['IT'], 'match'],
    [['de', 'it'], 'match'],
    [['ALL'], 'match'],
    [['GLOBAL'], 'match'],
    [['EU'], 'match'],
    [['EEA'], 'match'],
    [['DE', 'AT'], 'other_market'],
    [['US'], 'other_market'],
  ])('markets %j -> %s for a resident of Italy', (markets, expected) => {
    expect(classifyBroker({ markets, hqCountry: undefined }, italy)).toBe(expected);
  });

  it('does not treat EU as relevant for a resident outside the EEA', () => {
    expect(classifyBroker({ markets: ['EU'], hqCountry: undefined }, ['US'])).toBe('other_market');
    expect(classifyBroker({ markets: ['EU'], hqCountry: undefined }, ['NO'])).toBe('match');
  });

  it('falls back to the headquarters when no markets are declared', () => {
    expect(classifyBroker({ markets: [], hqCountry: 'IT' }, italy)).toBe('match');
    expect(classifyBroker({ markets: [], hqCountry: 'US' }, italy)).toBe('other_market');
    expect(classifyBroker({ markets: [], hqCountry: 'UK' }, ['GB'])).toBe('match');
  });

  it('declared markets win over the headquarters', () => {
    expect(classifyBroker({ markets: ['IT'], hqCountry: 'US' }, italy)).toBe('match');
    expect(classifyBroker({ markets: ['DE'], hqCountry: 'IT' }, italy)).toBe('other_market');
  });

  it('is unknown without markets and headquarters', () => {
    expect(classifyBroker({ markets: [], hqCountry: undefined }, italy)).toBe('unknown');
  });
});

describe('selectBrokersForProfile', () => {
  const all = [
    b('Zeta US', ['US']),
    b('Beta IT', ['IT']),
    b('Unknown Co', []),
    b('Alpha IT', ['IT']),
    b('Gamma ALL (official)', ['ALL'], { officialSiteVerified: true }),
    b('Delta DE', ['DE']),
  ];
  const names = (mode: 'prioritize' | 'strict' | 'off') => selectBrokersForProfile(all, ['IT'], mode).brokers.map((x) => x.name);

  it('prioritize: relevant first (official site first, then by name), other markets last, unknown never', () => {
    const { brokers, counts } = selectBrokersForProfile(all, ['IT'], 'prioritize');
    expect(brokers.map((x) => x.name)).toEqual(['Gamma ALL (official)', 'Alpha IT', 'Beta IT', 'Delta DE', 'Zeta US']);
    expect(counts).toEqual({ match: 3, otherMarket: 2, unknown: 1, contacted: 5 });
  });

  it('strict: only the brokers relevant to the profile', () => {
    expect(names('strict')).toEqual(['Gamma ALL (official)', 'Alpha IT', 'Beta IT']);
  });

  it('off: every broker in the original order, including unknown ones', () => {
    expect(names('off')).toEqual(all.map((x) => x.name));
    expect(selectBrokersForProfile(all, ['IT'], 'off').counts.contacted).toBe(all.length);
  });

  it('is deterministic and does not mutate the input', () => {
    const copy = [...all];
    expect(names('prioritize')).toEqual(names('prioritize'));
    expect(all).toEqual(copy);
  });
});
