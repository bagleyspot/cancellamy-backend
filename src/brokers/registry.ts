import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { BrokerChannel } from '../db/schemas';

export const CHANNEL_TYPES = ['email', 'pec', 'web_form', 'phone', 'postal', 'other'] as const;

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
  verificationStatus: string;
  lastVerified?: string;
  channels: BrokerChannel[];
  legalBasisNote?: string;
  obstacles?: string;
  idRequested?: string;
  notes?: string;
  streams: string[];
}

interface RawEntry {
  id?: string;
  name?: string;
  website?: string;
  domain?: string;
  category?: string;
  hq_country?: string;
  verification?: { status?: string; last_verified?: string };
  channels?: Array<{ type?: string; value?: string; label?: string; verified?: boolean }>;
  legal_basis_note?: string;
  obstacles?: string;
  id_requested?: string | boolean;
  notes?: string;
  stream_origin?: string[];
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

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
      verificationStatus: str(raw.verification?.status) ?? 'needs_research',
      lastVerified: str(raw.verification?.last_verified),
      channels,
      legalBasisNote: str(raw.legal_basis_note),
      obstacles: str(raw.obstacles),
      idRequested: raw.id_requested === undefined ? undefined : String(raw.id_requested),
      notes: str(raw.notes),
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
