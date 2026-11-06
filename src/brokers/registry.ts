import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { BrokerChannel, BrokerObservation } from '../db/schemas';

export const CHANNEL_TYPES = ['email', 'pec', 'web_form', 'phone', 'postal', 'other'] as const;

/** How a broker answered a real request (see docs/04-registry.md, "Comportamento osservato"). */
export const OBSERVATION_OUTCOMES = [
  'bounce_no_mailbox', // the address does not exist
  'bounce_blocked', // the recipient server rejected the message
  'no_reply', // nothing after the legal deadline
  'out_of_office', // automatic absence message
  'acknowledged', // receipt only (ticket, auto reply)
  'acknowledged_will_delete', // says it will delete, or treats the request as done
  'needs_portal', // the request must go through their portal or form
  'needs_identifier', // needs a device or cookie identifier
  'needs_extra_info', // asks for something else (see `requires`)
  'completed', // confirms the erasure
  'refused', // refuses, with or without a reason
] as const;
export const OBSERVATION_REQUIREMENTS = ['portal', 'email_verification', 'device_identifier', 'linkedin_url', 'id_document'] as const;

/** Categories never contacted automatically by default: erasure is limited by law or they are the regulator. */
export const DEFAULT_EXCLUDED_CATEGORIES = new Set([
  'regulator',
  'credit_bureau',
  'kyc_pep',
  'business_register',
  'public_records',
]);

export interface RegistryEntry {
  slug: string;
  name: string;
  website?: string;
  domain?: string;
  category: string;
  hqCountry?: string;
  markets: string[];
  officialSiteVerified: boolean;
  verificationStatus: string;
  lastVerified?: string;
  channels: BrokerChannel[];
  legalBasisNote?: string;
  obstacles?: string;
  idRequested?: string;
  notes?: string;
  observed: BrokerObservation[];
  streams: string[];
}

interface RawEntry {
  id?: string;
  name?: string;
  website?: string;
  domain?: string;
  category?: string;
  hq_country?: string;
  markets?: unknown[];
  provenance?: Array<{ verified_on_official_site?: boolean }>;
  verification?: { status?: string; last_verified?: string };
  channels?: Array<{ type?: string; value?: string; label?: string; verified?: boolean }>;
  legal_basis_note?: string;
  obstacles?: string;
  id_requested?: string | boolean;
  notes?: string;
  observed?: unknown;
  stream_origin?: string[];
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Markets come as a list whose items are sometimes comma separated ("DE,AT,CH") or "unknown": one clean code per item. */
export function parseMarkets(raw: unknown): string[] {
  const tokens = (Array.isArray(raw) ? raw : []).flatMap((m) => String(m).split(/[\s,;/]+/));
  return [...new Set(tokens.map((t) => t.trim().toUpperCase()).filter((t) => t && t !== 'UNKNOWN'))];
}

/** `observed` is a list of dated observations; a malformed one fails the load so a typo cannot silently drop data. */
export function parseObserved(raw: unknown, slug: string): BrokerObservation[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error(`${slug}: observed must be a list`);
  return raw.map((item: Record<string, unknown>, i) => {
    const where = `${slug}: observed[${i}]`;
    const date = item.date instanceof Date ? item.date.toISOString().slice(0, 10) : str(item.date);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${where}.date must be a YYYY-MM-DD date`);
    const outcome = str(item.outcome);
    if (!outcome || !(OBSERVATION_OUTCOMES as readonly string[]).includes(outcome)) throw new Error(`${where}.outcome must be one of ${OBSERVATION_OUTCOMES.join(', ')}`);
    if (typeof item.reachable !== 'boolean') throw new Error(`${where}.reachable must be true or false`);
    const requires = item.requires === undefined ? [] : item.requires;
    if (!Array.isArray(requires) || requires.some((r) => !(OBSERVATION_REQUIREMENTS as readonly string[]).includes(String(r)))) {
      throw new Error(`${where}.requires must be a list of ${OBSERVATION_REQUIREMENTS.join(', ')}`);
    }
    return { date, outcome, reachable: item.reachable, channel: str(item.channel), requires: requires.map(String), note: str(item.note) };
  });
}

export function parseRegistry(source: string): RegistryEntry[] {
  const doc = yaml.load(source) as { entries?: RawEntry[] } | undefined;
  if (!doc?.entries || !Array.isArray(doc.entries)) throw new Error('Registry file has no entries array');
  const seen = new Set<string>();
  const out: RegistryEntry[] = [];
  for (const raw of doc.entries) {
    const slug = str(raw.id);
    const name = str(raw.name);
    const category = str(raw.category);
    if (!slug || !name || !category) throw new Error(`Registry entry missing id/name/category: ${JSON.stringify(raw).slice(0, 120)}`);
    if (seen.has(slug)) throw new Error(`Duplicate registry id: ${slug}`);
    seen.add(slug);
    const channels = (raw.channels ?? [])
      .filter((c) => str(c.value))
      .map((c) => ({
        type: (CHANNEL_TYPES as readonly string[]).includes(c.type ?? '') ? (c.type as BrokerChannel['type']) : 'other',
        value: str(c.value) as string,
        label: str(c.label),
        verified: c.verified === true,
      }));
    out.push({
      slug,
      name,
      website: str(raw.website),
      domain: str(raw.domain),
      category,
      hqCountry: str(raw.hq_country),
      markets: parseMarkets(raw.markets),
      officialSiteVerified: (raw.provenance ?? []).some((p) => p?.verified_on_official_site === true),
      verificationStatus: str(raw.verification?.status) ?? 'needs_research',
      lastVerified: str(raw.verification?.last_verified),
      channels,
      legalBasisNote: str(raw.legal_basis_note),
      obstacles: str(raw.obstacles),
      idRequested: raw.id_requested === undefined ? undefined : String(raw.id_requested),
      notes: str(raw.notes),
      observed: parseObserved(raw.observed, slug),
      streams: Array.isArray(raw.stream_origin) ? raw.stream_origin.map(String) : [],
    });
  }
  return out;
}

export function loadRegistryFile(path: string): RegistryEntry[] {
  return parseRegistry(readFileSync(path, 'utf8'));
}

/** Only fully verified entries with a usable channel are contacted automatically. */
export function defaultSendEnabled(e: Pick<RegistryEntry, 'verificationStatus' | 'category' | 'channels'>): boolean {
  return (
    e.verificationStatus === 'verified' &&
    !DEFAULT_EXCLUDED_CATEGORIES.has(e.category) &&
    e.channels.some((c) => ['email', 'pec', 'web_form', 'phone'].includes(c.type))
  );
}
