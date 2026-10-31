import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { promises as dns } from 'dns';
import { Model } from 'mongoose';
import { Broker, BrokerChannel, BrokerDoc } from '../db/schemas';
import { resolvePublicHost } from '../sender/net-guard';
import { DEFAULT_EXCLUDED_CATEGORIES, defaultSendEnabled } from './registry';

export interface AutoVerifyOptions {
  /** Whether to crawl official websites for entries missing an email channel (default: true). */
  crawlWebsites?: boolean;
  /** Concurrency limit for parallel checks (default: 15). */
  concurrency?: number;
  /** Per-request HTTP timeout in milliseconds (default: 4500). */
  httpTimeoutMs?: number;
}

export interface AutoVerifyResultDto {
  checked: number;
  promoted: number;
  discovered: number;
  sendable: number;
}

export interface OfficialCrawlFinding {
  email: string;
  sourceUrl: string;
  matchedExisting: boolean;
}

export type MxResolver = (domain: string) => Promise<boolean>;
export type HtmlFetcher = (url: string, timeoutMs: number) => Promise<string | null>;

const KNOWN_DPO_DOMAINS = new Set([
  'verasafe.com',
  'edpo.com',
  'dp-dock.com',
  'lionheartsquared.eu',
  'lionheartsquared.co.uk',
  'gdprlocal.com',
  'datarep.com',
  'prighter.com',
  'itgovernance.eu',
  'itgovernance.co.uk',
  'twobirds.com',
  'mydata-trust.com',
  'privacylab.it',
  'iubenda.com',
  'onetrust.com',
  'trustarc.com',
]);

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

const PRIVACY_LOCAL_PREFIXES = [
  'privacy',
  'dpo',
  'gdpr',
  'dataprotection',
  'data-protection',
  'data.protection',
  'datenschutz',
  'personvern',
  'tietosuoja',
  'dataskydd',
  'rpd',
  'legal',
  'compliance',
  'optout',
  'opt-out',
  'removal',
  'dsar',
  'rights',
  'privacidad',
  'donneespersonnelles',
  'dpo-italia',
  'privacy.it',
];

const GENERAL_CONTACT_PREFIXES = [
  'info',
  'contact',
  'contacts',
  'kontakt',
  'contatti',
  'support',
  'service',
  'customercare',
  'customerservice',
  'help',
  'hello',
  'office',
  'mail',
  'post',
  'team',
  'amministrazione',
  'segreteria',
];

const JUNK_EMAIL_PATTERNS = [
  /^(?:no-?reply|donotreply|mailer-daemon|postmaster|abuse|webmaster|hostmaster|jobs|careers|press|media|sales|marketing|billing|invoice|hr|recruiting)@/i,
  /@(?:example\.|test\.|localhost|sentry\.io|wixpress\.com|w3\.org|schema\.org|googleapis\.com|cloudflare\.com|domain\.com|email\.com|yourcompany\.com|company\.com)/i,
  /\.(?:png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|eot|pdf|zip|mp4)$/i,
];

const EMAIL_SYNTAX_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** Decodes a Cloudflare `data-cfemail` hex string into a plain email address. */
export function decodeCfEmail(hex: string): string | null {
  if (!hex || hex.length < 4 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  }
  const clean = out.trim().toLowerCase();
  return isSyntacticallyValidEmail(clean) ? clean : null;
}

export function isSyntacticallyValidEmail(raw: string): boolean {
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_SYNTAX_RE.test(email)) return false;
  return !JUNK_EMAIL_PATTERNS.some((re) => re.test(email));
}

/** Extracts registrable brand root from a domain (e.g. `www.acxiom.co.uk` -> `acxiom`). */
export function extractBrandRoot(domainOrHost?: string): string | null {
  if (!domainOrHost) return null;
  const host = domainOrHost
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  const secondLevelTlds = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);
  if (parts.length >= 3 && parts[parts.length - 1].length === 2 && secondLevelTlds.has(parts[parts.length - 2])) {
    return parts[parts.length - 3];
  }
  return parts[parts.length - 2];
}

/** Scores an email candidate for GDPR erasure suitability (higher is better; < 0 means rejected). */
export function scoreCandidateEmail(email: string, brokerDomain?: string): number {
  const clean = email.trim().toLowerCase();
  if (!isSyntacticallyValidEmail(clean)) return -1;
  const [local, emailDomain] = clean.split('@');
  if (!local || !emailDomain) return -1;

  const cleanBrokerDomain = brokerDomain
    ?.trim()
    .toLowerCase()
    .replace(/^www\./, '');
  const brokerBrand = extractBrandRoot(cleanBrokerDomain);
  const emailBrand = extractBrandRoot(emailDomain);

  const sameExactDomain = Boolean(
    cleanBrokerDomain && (emailDomain === cleanBrokerDomain || emailDomain.endsWith(`.${cleanBrokerDomain}`)),
  );
  const sameBrand = Boolean(brokerBrand && brokerBrand.length >= 3 && brokerBrand === emailBrand);
  const isKnownDpo = KNOWN_DPO_DOMAINS.has(emailDomain);

  const isPrivacyLocal = PRIVACY_LOCAL_PREFIXES.some(
    (p) => local === p || local.startsWith(`${p}.`) || local.startsWith(`${p}-`) || local.startsWith(`${p}_`) || local.endsWith(`.${p}`) || local.includes('privacy') || local.includes('dpo') || local.includes('gdpr') || local.includes('datenschutz'),
  );
  const isGeneralLocal = GENERAL_CONTACT_PREFIXES.some(
    (p) => local === p || local.startsWith(`${p}.`) || local.startsWith(`${p}-`),
  );

  let score = 0;
  if (sameExactDomain) score += 50;
  else if (sameBrand) score += 40;
  else if (isKnownDpo) score += 45;
  else if (!cleanBrokerDomain) score += 20;

  if (isPrivacyLocal) score += 40;
  else if (isGeneralLocal) score += 15;
  else if (sameExactDomain || sameBrand) score += 10;

  return score;
}

/** Extracts and ranks candidate emails from an HTML document, including Cloudflare obfuscated emails. */
export function extractEmailsFromHtml(html: string, brokerDomain?: string): string[] {
  const found = new Set<string>();

  // 1. Decode Cloudflare data-cfemail attributes
  const cfRe = /data-cfemail=["']([0-9a-fA-F]{6,120})["']/g;
  let cfMatch: RegExpExecArray | null;
  while ((cfMatch = cfRe.exec(html)) !== null) {
    const decoded = decodeCfEmail(cfMatch[1]);
    if (decoded) found.add(decoded);
  }

  // 2. Decode common HTML entities and lightly obfuscated [at] notations around privacy keywords
  const normalized = html
    .replace(/&#64;|&#x40;|&commat;/gi, '@')
    .replace(/&#46;|&#x2e;|&period;/gi, '.')
    .replace(/\b(privacy|dpo|gdpr|datenschutz|dataprotection|rpd|legal|info|contact|kontakt)\s*(?:\[at\]|\(at\)|\s+at\s+)\s*([a-z0-9.-]+\.[a-z]{2,12})\b/gi, '$1@$2');

  // 3. Extract mailto: links and plain emails
  const emailRe = /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\b/gi;
  let match: RegExpExecArray | null;
  while ((match = emailRe.exec(normalized)) !== null) {
    const clean = match[0].replace(/[.,;:!?)]+$/, '').toLowerCase();
    if (isSyntacticallyValidEmail(clean)) found.add(clean);
  }

  return [...found]
    .map((email) => ({ email, score: scoreCandidateEmail(email, brokerDomain) }))
    .filter((item) => item.score >= 35)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.email);
}

/** Extracts privacy/GDPR/DPO links from an HTML page relative to `baseUrl`. */
export function extractPrivacyLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const hrefRe = /href=["']([^"'#]+)["']/gi;
  const linkKeywordRe = /(?:privacy|datenschutz|informativa|gdpr|dpo|data-protection|donnees-personnelles|privacidad|impressum|legal|diritti|opt-?out)/i;
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(html)) !== null) {
    const rawHref = match[1].trim();
    if (!rawHref || !linkKeywordRe.test(rawHref)) continue;
    try {
      const resolved = new URL(rawHref, base);
      // Allowlist, not blocklist: mailto:, tel:, javascript:, data:, vbscript: and anything else is dropped here.
      if (!['http:', 'https:'].includes(resolved.protocol)) continue;
      out.add(resolved.toString());
    } catch {
      // Ignore malformed URLs
    }
    if (out.size >= 5) break;
  }
  return [...out];
}

export async function defaultMxResolver(domain: string): Promise<boolean> {
  const clean = domain.trim().toLowerCase();
  if (!clean) return false;
  try {
    const mx = await Promise.race([
      dns.resolveMx(clean),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), 3500)),
    ]);
    if (Array.isArray(mx) && mx.some((r) => Boolean(r.exchange && r.exchange !== '.'))) {
      return true;
    }
  } catch {
    // Fallback to A record per RFC 5321 section 5.1
  }
  try {
    const a = await Promise.race([
      dns.resolve4(clean),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), 2500)),
    ]);
    return Array.isArray(a) && a.length > 0;
  } catch {
    return false;
  }
}

const MAX_REDIRECTS = 3;

/** Only plain web ports: the crawler must not be usable to probe other services. */
function isWebPort(u: URL): boolean {
  return u.port === '' || u.port === '80' || u.port === '443';
}

/**
 * Downloads a page of a broker's own site. Every hop (the first URL and each redirect) must be http(s) on a standard
 * port and resolve to a public address, so a hostile site cannot steer the crawler to internal services.
 */
export async function defaultHtmlFetcher(url: string, timeoutMs = 4500): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const target = new URL(current);
      if (!['http:', 'https:'].includes(target.protocol) || !isWebPort(target)) return null;
      await resolvePublicHost(target.hostname.replace(/^\[|\]$/g, ''));
      const res = await fetch(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CancellamyVerifier/1.0; +https://github.com/cancellamy)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
          'Accept-Language': 'it-IT,it;q=0.9,en-GB;q=0.8,en;q=0.7',
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return null;
        current = new URL(location, current).toString();
        continue;
      }
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType && !/text\/html|text\/plain|application\/xhtml/i.test(contentType)) return null;
      const text = await res.text();
      return text.slice(0, 350_000);
    }
    return null; // too many redirects
  } catch {
    return null; // includes HostNotAllowedError and invalid URLs
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class BrokerVerifierService {
  private readonly logger = new Logger(BrokerVerifierService.name);
  private mxResolver: MxResolver = defaultMxResolver;
  private htmlFetcher: HtmlFetcher = defaultHtmlFetcher;

  constructor(@InjectModel(Broker.name) private readonly brokers: Model<BrokerDoc>) {}

  /** Overrides network resolvers (used in unit/e2e tests). */
  setResolvers(opts: { mxResolver?: MxResolver; htmlFetcher?: HtmlFetcher }): void {
    if (opts.mxResolver) this.mxResolver = opts.mxResolver;
    if (opts.htmlFetcher) this.htmlFetcher = opts.htmlFetcher;
  }

  /** Checks whether an email domain has a valid mail server (cached per map). */
  async hasValidMx(email: string, cache = new Map<string, Promise<boolean>>()): Promise<boolean> {
    if (!isSyntacticallyValidEmail(email)) return false;
    const domain = email.trim().toLowerCase().split('@')[1];
    if (!domain) return false;
    let pending = cache.get(domain);
    if (!pending) {
      pending = this.mxResolver(domain);
      cache.set(domain, pending);
    }
    return pending;
  }

  /** Crawls a broker's official website and privacy pages to verify or discover a GDPR email. */
  async crawlOfficialSite(
    broker: { website?: string; domain?: string; channels?: BrokerChannel[]; provenanceRefs?: string[] },
    timeoutMs = 4500,
  ): Promise<OfficialCrawlFinding | null> {
    const existingEmails = new Set(
      (broker.channels ?? [])
        .filter((c) => c.type === 'email')
        .map((c) => c.value.trim().toLowerCase()),
    );

    const candidateUrls = new Set<string>();
    for (const ref of broker.provenanceRefs ?? []) {
      if (ref && /^https?:\/\//i.test(ref)) candidateUrls.add(ref);
    }
    for (const ch of broker.channels ?? []) {
      if ((ch.type === 'other' || ch.type === 'web_form') && /^https?:\/\//i.test(ch.value)) {
        candidateUrls.add(ch.value);
      }
    }

    const baseSite =
      broker.website && /^https?:\/\//i.test(broker.website)
        ? broker.website.replace(/\/+$/, '')
        : broker.domain
          ? `https://${broker.domain.replace(/^www\./, '')}`
          : null;

    if (baseSite) {
      candidateUrls.add(baseSite);
      for (const path of ['/privacy', '/privacy-policy', '/informativa-privacy', '/gdpr', '/datenschutz']) {
        try {
          candidateUrls.add(new URL(path, baseSite).toString());
        } catch {
          // ignore
        }
      }
    }

    const domain =
      broker.domain ??
      (baseSite
        ? (() => {
            try {
              return new URL(baseSite).hostname.replace(/^www\./, '');
            } catch {
              return undefined;
            }
          })()
        : undefined);

    const visited = new Set<string>();
    const queue = [...candidateUrls].slice(0, 6);

    while (queue.length > 0 && visited.size < 6) {
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);

      const html = await this.htmlFetcher(url, timeoutMs);
      if (!html) continue;

      const extracted = extractEmailsFromHtml(html, domain);
      for (const email of extracted) {
        if (existingEmails.has(email)) {
          return { email, sourceUrl: url, matchedExisting: true };
        }
      }
      if (extracted.length > 0) {
        const best = extracted[0];
        if (scoreCandidateEmail(best, domain) >= 55) {
          return { email: best, sourceUrl: url, matchedExisting: false };
        }
      }

      if (visited.size === 1) {
        for (const link of extractPrivacyLinks(html, url)) {
          if (!visited.has(link) && queue.length < 6) queue.push(link);
        }
      }
    }

    return null;
  }

  /** Evaluates whether a single broker can be promoted to `verified` via DNS/MX + official crawl. */
  async verifyBrokerEntry(
    broker: {
      slug: string;
      category: string;
      verificationStatus: string;
      website?: string;
      domain?: string;
      channels: BrokerChannel[];
      provenanceRefs?: string[];
    },
    opts: { crawlWebsites?: boolean; httpTimeoutMs?: number; mxCache?: Map<string, Promise<boolean>> } = {},
  ): Promise<{
    verified: boolean;
    discovered: boolean;
    channels: BrokerChannel[];
    sourceUrl?: string;
    method?: 'official_site' | 'dns_mx' | 'verified_channel';
  }> {
    if (DEFAULT_EXCLUDED_CATEGORIES.has(broker.category)) {
      return { verified: false, discovered: false, channels: broker.channels };
    }

    const mxCache = opts.mxCache ?? new Map<string, Promise<boolean>>();
    const channels: BrokerChannel[] = broker.channels.map((c) => ({
      type: c.type,
      value: c.value,
      ...(c.label ? { label: c.label } : {}),
      verified: c.verified === true,
    }));
    const emailChannels = channels.filter((c) => c.type === 'email');

    // 1. Validate existing email channels via DNS MX + legitimacy score
    let validEmailChannel = false;
    for (const ch of emailChannels) {
      const score = scoreCandidateEmail(ch.value, broker.domain ?? broker.website);
      if (score >= 15 && (await this.hasValidMx(ch.value, mxCache))) {
        ch.verified = true;
        validEmailChannel = true;
      }
    }

    if (validEmailChannel) {
      return {
        verified: true,
        discovered: false,
        channels,
        method: 'dns_mx',
      };
    }

    // 2. Crawl official website if enabled and no valid email was verified yet
    if (opts.crawlWebsites !== false && (broker.website || broker.domain || channels.length > 0)) {
      const crawled = await this.crawlOfficialSite(broker, opts.httpTimeoutMs ?? 4500);
      if (crawled && (await this.hasValidMx(crawled.email, mxCache))) {
        const existing = channels.find((c) => c.type === 'email' && c.value.toLowerCase() === crawled.email.toLowerCase());
        if (existing) {
          existing.verified = true;
          return {
            verified: true,
            discovered: false,
            channels,
            sourceUrl: crawled.sourceUrl,
            method: 'official_site',
          };
        }
        channels.unshift({
          type: 'email',
          value: crawled.email,
          label: 'privacy',
          verified: true,
        });
        return {
          verified: true,
          discovered: true,
          channels,
          sourceUrl: crawled.sourceUrl,
          method: 'official_site',
        };
      }
    }

    // 3. Check PEC, phone, or recognized web_form channels on existing entries
    for (const ch of channels) {
      if (ch.type === 'pec' && (await this.hasValidMx(ch.value, mxCache))) {
        ch.verified = true;
        return { verified: true, discovered: false, channels, method: 'verified_channel' };
      }
      if (ch.type === 'phone' && ch.verified && ch.value.trim().length >= 3) {
        return { verified: true, discovered: false, channels, method: 'verified_channel' };
      }
      if (ch.type === 'web_form' && /^https:\/\//i.test(ch.value)) {
        const formBrand = extractBrandRoot(ch.value);
        const brokerBrand = extractBrandRoot(broker.domain ?? broker.website);
        const isKnownPortal = KNOWN_FORM_HOSTS.some((h) => ch.value.toLowerCase().includes(h));
        if (ch.verified || isKnownPortal || (formBrand && brokerBrand && formBrand === brokerBrand)) {
          ch.verified = true;
          return { verified: true, discovered: false, channels, method: 'verified_channel' };
        }
      }
    }

    return { verified: false, discovered: false, channels };
  }

  /** Runs automated verification across all eligible brokers in MongoDB and updates sendEnabled. */
  async autoVerifyAll(opts: AutoVerifyOptions = {}): Promise<AutoVerifyResultDto> {
    const docs = await this.brokers.find({
      category: { $nin: [...DEFAULT_EXCLUDED_CATEGORIES] },
      verificationStatus: { $ne: 'verified' },
    });

    const mxCache = new Map<string, Promise<boolean>>();
    const concurrency = Math.max(1, Math.min(opts.concurrency ?? 15, 40));
    const today = new Date().toISOString().slice(0, 10);

    let checked = 0;
    let promoted = 0;
    let discovered = 0;

    const queue = [...docs];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const doc = queue.shift();
        if (!doc) break;
        const edited = new Set(doc.adminEdited ?? []);
        if (edited.has('sendEnabled') || edited.has('verificationStatus')) continue;

        checked++;
        const res = await this.verifyBrokerEntry(
          {
            slug: doc.slug,
            category: doc.category,
            verificationStatus: doc.verificationStatus,
            website: doc.website,
            domain: doc.domain,
            channels: doc.channels,
          },
          { crawlWebsites: opts.crawlWebsites ?? true, httpTimeoutMs: opts.httpTimeoutMs ?? 4500, mxCache },
        );

        if (res.verified) {
          doc.set('channels', res.channels);
          doc.verificationStatus = 'verified';
          doc.lastVerified = today;
          doc.sendEnabled = defaultSendEnabled({
            verificationStatus: 'verified',
            category: doc.category,
            channels: res.channels,
          });
          await doc.save();
          promoted++;
          if (res.discovered) discovered++;
        }
      }
    });

    await Promise.all(workers);
    const sendable = await this.brokers.countDocuments({ sendEnabled: true });
    this.logger.log(`autoVerifyAll completed: checked=${checked}, promoted=${promoted}, discovered=${discovered}, sendable=${sendable}`);
    return { checked, promoted, discovered, sendable };
  }
}
