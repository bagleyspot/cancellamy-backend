import type { Broker } from '../db/schemas';

/**
 * How a new profile is matched with the registry:
 * - `prioritize` (default): brokers that operate where the profile lives go first, brokers of other markets go last, and
 *   brokers whose market is unknown are not contacted automatically until someone classifies them;
 * - `strict`: only brokers that operate where the profile lives;
 * - `off`: every sendable broker, in registry order (the behaviour before relevance existed).
 */
export const RELEVANCE_MODES = ['prioritize', 'strict', 'off'] as const;
export type RelevanceMode = (typeof RELEVANCE_MODES)[number];

export type Relevance = 'match' | 'other_market' | 'unknown';

const GLOBAL_MARKETS = new Set(['ALL', 'GLOBAL', 'WORLD']);
const EU_MARKETS = new Set(['EU', 'EEA']);
/** EU and EEA member states: a broker that serves "EU" is relevant to a resident of any of them. */
const EEA_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO',
]);
const DEFAULT_COUNTRIES = ['IT'];

const normalize = (country: string): string => {
  const c = country.trim().toUpperCase();
  return c === 'UK' ? 'GB' : c;
};

/** The countries of the profile's addresses; Cancellamy serves people in Italy, so that is the fallback. */
export function profileCountries(addresses: ReadonlyArray<{ country: string }>): string[] {
  const countries = [...new Set(addresses.map((a) => normalize(a.country)).filter(Boolean))];
  return countries.length ? countries : DEFAULT_COUNTRIES;
}

export function classifyBroker(broker: Pick<Broker, 'markets' | 'hqCountry'>, countries: readonly string[]): Relevance {
  const markets = (broker.markets ?? []).map(normalize);
  if (markets.length) {
    if (markets.some((m) => countries.includes(m) || GLOBAL_MARKETS.has(m))) return 'match';
    if (markets.some((m) => EU_MARKETS.has(m)) && countries.some((c) => EEA_COUNTRIES.has(c))) return 'match';
    return 'other_market';
  }
  // No markets declared: the headquarters is the only hint.
  if (broker.hqCountry) return countries.includes(normalize(broker.hqCountry)) ? 'match' : 'other_market';
  return 'unknown';
}

export interface BrokerSelection<T> {
  brokers: T[];
  counts: { match: number; otherMarket: number; unknown: number; contacted: number };
}

/** Chooses and orders the brokers a profile is contacted through. Pure: the same input always gives the same order. */
export function selectBrokersForProfile<T extends Pick<Broker, 'markets' | 'hqCountry' | 'officialSiteVerified' | 'name'>>(
  all: readonly T[],
  countries: readonly string[],
  mode: RelevanceMode,
): BrokerSelection<T> {
  const classified = all.map((broker) => ({ broker, relevance: classifyBroker(broker, countries) }));
  const counts = {
    match: classified.filter((c) => c.relevance === 'match').length,
    otherMarket: classified.filter((c) => c.relevance === 'other_market').length,
    unknown: classified.filter((c) => c.relevance === 'unknown').length,
    contacted: 0,
  };
  if (mode === 'off') {
    counts.contacted = all.length;
    return { brokers: [...all], counts };
  }
  const tier = (r: Relevance) => (r === 'match' ? 0 : 1);
  const kept = classified
    .filter((c) => c.relevance === 'match' || (mode === 'prioritize' && c.relevance === 'other_market'))
    .sort(
      (a, b) =>
        tier(a.relevance) - tier(b.relevance) ||
        Number(!!b.broker.officialSiteVerified) - Number(!!a.broker.officialSiteVerified) ||
        a.broker.name.localeCompare(b.broker.name),
    )
    .map((c) => c.broker);
  counts.contacted = kept.length;
  return { brokers: kept, counts };
}
