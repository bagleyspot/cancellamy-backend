import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import * as yaml from 'js-yaml';
import { BrokerChannel } from '../db/schemas';
import { DEFAULT_EXCLUDED_CATEGORIES, defaultSendEnabled } from './registry';
import {
  defaultHtmlFetcher,
  defaultMxResolver,
  extractBrandRoot,
  extractEmailsFromHtml,
  extractPrivacyLinks,
  isSyntacticallyValidEmail,
  scoreCandidateEmail,
} from './broker-verifier.service';

interface RawChannel {
  type: string;
  value: string;
  label?: string;
  verified?: boolean;
}

interface RawProvenance {
  stream?: string;
  ref?: string;
  license?: string;
  verified_on_official_site?: boolean;
}

interface RawBrokerEntry {
  id: string;
  name: string;
  website?: string;
  domain?: string;
  category: string;
  hq_country?: string;
  channels?: RawChannel[];
  legal_basis_note?: string;
  obstacles?: string;
  id_requested?: string | boolean;
  verification?: { status?: string; last_verified?: string };
  notes?: string;
  provenance?: RawProvenance[];
  stream_origin?: string[];
}

interface RawRegistryDoc {
  version?: number;
  generated?: string;
  license_note?: string;
  counts?: Record<string, unknown>;
  entries: RawBrokerEntry[];
}

const KNOWN_FORM_HOSTS = [
  'onetrust.com',
  'trustarc.com',
  'saymine.com',
  'transcend.io',
  'privacycockpit.com',
  'google.com',
  'bing.com',
  'tally.so',
  'italiaonline.it',
];

async function hasMxCached(email: string, cache: Map<string, Promise<boolean>>): Promise<boolean> {
  if (!isSyntacticallyValidEmail(email)) return false;
  const domain = email.trim().toLowerCase().split('@')[1];
  if (!domain) return false;
  let p = cache.get(domain);
  if (!p) {
    p = defaultMxResolver(domain);
    cache.set(domain, p);
  }
  return p;
}

async function crawlEntryForOfficialEmail(
  entry: RawBrokerEntry,
  timeoutMs: number,
): Promise<{ email: string; sourceUrl: string; matchedExisting: boolean } | null> {
  const existingEmails = new Set(
    (entry.channels ?? [])
      .filter((c) => c.type === 'email' && c.value)
      .map((c) => c.value.trim().toLowerCase()),
  );

  const urls = new Set<string>();
  for (const p of entry.provenance ?? []) {
    if (p.ref && /^https?:\/\//i.test(p.ref)) urls.add(p.ref);
  }
  for (const ch of entry.channels ?? []) {
    if ((ch.type === 'other' || ch.type === 'web_form') && /^https?:\/\//i.test(ch.value)) {
      urls.add(ch.value);
    }
  }

  const baseSite =
    entry.website && /^https?:\/\//i.test(entry.website)
      ? entry.website.replace(/\/+$/, '')
      : entry.domain
        ? `https://${entry.domain.replace(/^www\./, '')}`
        : null;

  if (baseSite) {
    urls.add(baseSite);
    for (const p of ['/privacy', '/privacy-policy', '/informativa-privacy', '/gdpr', '/datenschutz']) {
      try {
        urls.add(new URL(p, baseSite).toString());
      } catch {
        // ignore
      }
    }
  }

  const domain = entry.domain ?? (baseSite ? new URL(baseSite).hostname.replace(/^www\./, '') : undefined);
  const visited = new Set<string>();
  const queue = [...urls].slice(0, 6);

  while (queue.length > 0 && visited.size < 6) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    const html = await defaultHtmlFetcher(url, timeoutMs);
    if (!html) continue;

    const emails = extractEmailsFromHtml(html, domain);
    for (const em of emails) {
      if (existingEmails.has(em)) {
        return { email: em, sourceUrl: url, matchedExisting: true };
      }
    }
    if (emails.length > 0 && scoreCandidateEmail(emails[0], domain) >= 55) {
      return { email: emails[0], sourceUrl: url, matchedExisting: false };
    }

    if (visited.size === 1) {
      for (const link of extractPrivacyLinks(html, url)) {
        if (!visited.has(link) && queue.length < 6) queue.push(link);
      }
    }
  }
  return null;
}

async function main(): Promise<void> {
  const registryPath = resolve(__dirname, '..', '..', 'registry', 'brokers.yaml');
  const rootRegistryPath = resolve(__dirname, '..', '..', '..', 'registry', 'brokers.yaml');
  const rawYaml = readFileSync(registryPath, 'utf8');
  const doc = yaml.load(rawYaml) as RawRegistryDoc;

  const today = new Date().toISOString().slice(0, 10);
  const mxCache = new Map<string, Promise<boolean>>();

  const beforeSendable = doc.entries.filter((e) =>
    defaultSendEnabled({
      verificationStatus: e.verification?.status ?? 'needs_research',
      category: e.category,
      channels: (e.channels ?? []) as BrokerChannel[],
    }),
  ).length;

  let checked = 0;
  let promotedMx = 0;
  let promotedCrawled = 0;
  let discoveredNew = 0;
  let promotedFormOrPec = 0;

  const targets = doc.entries.filter(
    (e) => !DEFAULT_EXCLUDED_CATEGORIES.has(e.category) && e.verification?.status !== 'verified',
  );

  const concurrency = 20;
  const queue = [...targets];

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) break;
      checked++;

      const channels = entry.channels ?? [];
      const emailChannels = channels.filter((c) => c.type === 'email' && c.value);

      // Step 1: Validate existing email channels via DNS MX + legitimacy score
      let hasValidExistingEmail = false;
      for (const ch of emailChannels) {
        const score = scoreCandidateEmail(ch.value, entry.domain ?? entry.website);
        if (score >= 15 && (await hasMxCached(ch.value, mxCache))) {
          ch.verified = true;
          hasValidExistingEmail = true;
        }
      }

      if (hasValidExistingEmail) {
        entry.verification = { status: 'verified', last_verified: today };
        promotedMx++;
        continue;
      }

      // Step 2: Crawl official website for entries without a valid email channel
      if (entry.website || entry.domain || channels.length > 0) {
        const crawled = await crawlEntryForOfficialEmail(entry, 4500);
        if (crawled && (await hasMxCached(crawled.email, mxCache))) {
          const existing = channels.find((c) => c.type === 'email' && c.value.toLowerCase() === crawled.email.toLowerCase());
          if (existing) {
            existing.verified = true;
            promotedCrawled++;
          } else {
            entry.channels = [
              { type: 'email', value: crawled.email, label: 'privacy', verified: true },
              ...channels,
            ];
            discoveredNew++;
          }
          entry.verification = { status: 'verified', last_verified: today };
          entry.provenance = [
            ...(entry.provenance ?? []),
            {
              stream: 'C',
              ref: crawled.sourceUrl,
              license: 'own-research',
              verified_on_official_site: true,
            },
          ];
          continue;
        }
      }

      // Step 3: Check PEC, verified phone, or official web_form channels
      for (const ch of channels) {
        if (ch.type === 'pec' && (await hasMxCached(ch.value, mxCache))) {
          ch.verified = true;
          entry.verification = { status: 'verified', last_verified: today };
          promotedFormOrPec++;
          break;
        }
        if (ch.type === 'phone' && ch.verified && ch.value.trim().length >= 3) {
          entry.verification = { status: 'verified', last_verified: today };
          promotedFormOrPec++;
          break;
        }
        if (ch.type === 'web_form' && /^https:\/\//i.test(ch.value)) {
          const formBrand = extractBrandRoot(ch.value);
          const brokerBrand = extractBrandRoot(entry.domain ?? entry.website);
          const isKnownPortal = KNOWN_FORM_HOSTS.some((h) => ch.value.toLowerCase().includes(h));
          if (ch.verified || isKnownPortal || (formBrand && brokerBrand && formBrand === brokerBrand)) {
            ch.verified = true;
            entry.verification = { status: 'verified', last_verified: today };
            promotedFormOrPec++;
            break;
          }
        }
      }
    }
  });

  await Promise.all(workers);

  // Recompute top-level counts metadata if present
  const byVerification: Record<string, number> = {};
  for (const e of doc.entries) {
    const st = e.verification?.status ?? 'needs_research';
    byVerification[st] = (byVerification[st] ?? 0) + 1;
  }
  if (doc.counts) {
    doc.counts.total = doc.entries.length;
    doc.counts.by_verification = byVerification;
  }

  const afterSendable = doc.entries.filter((e) =>
    defaultSendEnabled({
      verificationStatus: e.verification?.status ?? 'needs_research',
      category: e.category,
      channels: (e.channels ?? []) as BrokerChannel[],
    }),
  ).length;

  const dumped = yaml.dump(doc, { lineWidth: 120, noRefs: true });
  writeFileSync(registryPath, dumped, 'utf8');
  if (existsSync(join(rootRegistryPath, '..'))) {
    writeFileSync(rootRegistryPath, dumped, 'utf8');
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        checked,
        promotedMx,
        promotedCrawled,
        discoveredNew,
        promotedFormOrPec,
        beforeSendable,
        afterSendable,
        byVerification,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
