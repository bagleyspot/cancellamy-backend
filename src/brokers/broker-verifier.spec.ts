import {
  BrokerVerifierService,
  decodeCfEmail,
  defaultHtmlFetcher,
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

describe('extractPrivacyLinks: only web links are followed', () => {
  it('drops mailto:, tel:, javascript:, data: and vbscript: links even when they mention privacy', () => {
    const html = [
      '<a href="mailto:privacy@acme.com">privacy</a>',
      '<a href="tel:+390000000000-privacy">privacy</a>',
      '<a href="javascript:openPrivacy()">privacy</a>',
      '<a href="data:text/html,privacy">privacy</a>',
      '<a href="vbscript:privacy">privacy</a>',
      '<a href="ftp://files.acme.com/privacy.pdf">privacy</a>',
      '<a href="/privacy-policy">privacy</a>',
    ].join('\n');
    expect(extractPrivacyLinks(html, 'https://acme.com')).toEqual(['https://acme.com/privacy-policy']);
  });
});

describe('defaultHtmlFetcher: the crawler only reaches public web servers', () => {
  const fetchMock = jest.spyOn(global, 'fetch');
  const PUBLIC = 'https://93.184.216.34'; // a public address: no DNS lookup is needed
  const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
  beforeEach(() => fetchMock.mockReset());
  afterAll(() => fetchMock.mockRestore());

  it.each([
    'http://127.0.0.1/privacy',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.1.2.3/privacy',
    'http://192.168.0.1/privacy',
    'http://[::1]/privacy',
    'https://93.184.216.34:6379/',
    'https://93.184.216.34:8080/privacy',
    'file:///etc/passwd',
    'ftp://93.184.216.34/privacy',
    'not a url',
  ])('refuses %s without opening a connection', async (url) => {
    expect(await defaultHtmlFetcher(url)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches a public page, without following redirects blindly', async () => {
    fetchMock.mockResolvedValueOnce(html('<p>privacy@acme.com</p>'));
    expect(await defaultHtmlFetcher(`${PUBLIC}/privacy`)).toBe('<p>privacy@acme.com</p>');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).redirect).toBe('manual');
  });

  it('follows a redirect to another public address', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://93.184.216.35/privacy')).mockResolvedValueOnce(html('ok'));
    expect(await defaultHtmlFetcher(`${PUBLIC}/start`)).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['http://127.0.0.1:8080/admin', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'file:///etc/passwd'])(
    'stops when a redirect points to %s',
    async (target) => {
      fetchMock.mockResolvedValueOnce(redirect(target));
      expect(await defaultHtmlFetcher(`${PUBLIC}/start`)).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1); // the second hop is never requested
    },
  );

  it('gives up after three redirects and on non-HTML content', async () => {
    fetchMock.mockImplementation(async () => redirect(`${PUBLIC}/again`));
    expect(await defaultHtmlFetcher(`${PUBLIC}/loop`)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } }));
    expect(await defaultHtmlFetcher(`${PUBLIC}/file.pdf`)).toBeNull();
  });
});
