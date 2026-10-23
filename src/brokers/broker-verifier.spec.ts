import {
  BrokerVerifierService,
  decodeCfEmail,
  extractBrandRoot,
  extractEmailsFromHtml,
  extractPrivacyLinks,
  isSyntacticallyValidEmail,
  scoreCandidateEmail,
} from './broker-verifier.service';

describe('broker-verifier helpers', () => {
  it('decodes Cloudflare obfuscated emails and rejects invalid hex', () => {
    // 'privacy@lusha.com' encoded with key 0x2a
    const key = 0x2a;
    const plain = 'privacy@lusha.com';
    const hex =
      key.toString(16).padStart(2, '0') +
      Array.from(plain)
        .map((ch) => (ch.charCodeAt(0) ^ key).toString(16).padStart(2, '0'))
        .join('');
    expect(decodeCfEmail(hex)).toBe('privacy@lusha.com');
    expect(decodeCfEmail('zz')).toBeNull();
    expect(decodeCfEmail('123')).toBeNull();
  });

  it('validates syntax and filters out noreply/junk addresses', () => {
    expect(isSyntacticallyValidEmail('dpo@cerved.com')).toBe(true);
    expect(isSyntacticallyValidEmail('noreply@cerved.com')).toBe(false);
    expect(isSyntacticallyValidEmail('logo@2x.png')).toBe(false);
    expect(isSyntacticallyValidEmail('test@example.com')).toBe(false);
  });

  it('extracts brand root across single and compound TLDs', () => {
    expect(extractBrandRoot('https://www.acxiom.co.uk/privacy')).toBe('acxiom');
    expect(extractBrandRoot('cerved.com')).toBe('cerved');
  });

  it('scores domain-matching privacy emails highest and extracts them from HTML', () => {
    expect(scoreCandidateEmail('privacy@acme.com', 'acme.com')).toBeGreaterThan(scoreCandidateEmail('info@acme.com', 'acme.com'));
    const html = `
      <html>
        <body>
          <a href="/privacy-policy">Privacy Policy</a>
          <p>Contact our DPO at dpo [at] acme.com or <a href="mailto:info@acme.com">info@acme.com</a></p>
        </body>
      </html>
    `;
    const emails = extractEmailsFromHtml(html, 'acme.com');
    expect(emails[0]).toBe('dpo@acme.com');
    expect(emails).toContain('info@acme.com');

    const links = extractPrivacyLinks(html, 'https://acme.com');
    expect(links).toEqual(['https://acme.com/privacy-policy']);
  });

  it('verifies existing emails via MX and crawls official sites when needed', async () => {
    const svc = new BrokerVerifierService({} as never);
    svc.setResolvers({
      mxResolver: async (domain) => domain === 'daverificare.com' || domain === ' crawled.it',
      htmlFetcher: async (url) => (url.includes('crawled.it') ? '<p>Scrivi a privacy@crawled.it</p>' : null),
    });

    const mxRes = await svc.verifyBrokerEntry({
      slug: 'not-yet',
      category: 'marketing_adtech',
      verificationStatus: 'third_party',
      domain: 'daverificare.com',
      channels: [{ type: 'email', value: 'dpo@daverificare.com', verified: false }],
    });
    expect(mxRes.verified).toBe(true);
    expect(mxRes.method).toBe('dns_mx');
    expect(mxRes.channels[0]?.verified).toBe(true);

    const excludedRes = await svc.verifyBrokerEntry({
      slug: 'garante',
      category: 'regulator',
      verificationStatus: 'third_party',
      domain: 'garanteprivacy.it',
      channels: [{ type: 'email', value: 'protocollo@gpdp.it', verified: false }],
    });
    expect(excludedRes.verified).toBe(false);
  });
});
