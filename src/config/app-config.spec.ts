import { computeFeatures, loadConfig } from './app-config';

describe('loadConfig', () => {
  it('provides safe defaults outside production (dry-run mail)', () => {
    const c = loadConfig({ NODE_ENV: 'development' });
    expect(c.mailMode).toBe('dry-run');
    expect(c.dataEncryptionKey).toHaveLength(32);
    expect(c.responseDeadlineDays).toBe(30);
    expect(c.resendDailyLimit).toBe(100);
    expect(c.resendMonthlyLimit).toBe(3000);
    expect(c.resendSystemReserve).toBe(5);
    expect(c.userDailyRequestLimit).toBe(5);
    expect(c.redisHost).toBe('localhost');
    expect(c.redisPort).toBe(6379);
    expect(c.queueEnabled).toBe(true);
  });

  it('refuses production without secrets', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('accepts a complete production config', () => {
    const c = loadConfig({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'x'.repeat(40),
      DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    });
    expect(c.cookieSecure).toBe(true);
    expect(c.mailMode).toBe('dry-run');
  });

  it('chooses how brokers are matched with a profile, prioritizing by default', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).brokerRelevance).toBe('prioritize');
    expect(loadConfig({ NODE_ENV: 'development', BROKER_RELEVANCE: 'Strict' }).brokerRelevance).toBe('strict');
    expect(loadConfig({ NODE_ENV: 'development', BROKER_RELEVANCE: 'off' }).brokerRelevance).toBe('off');
    expect(() => loadConfig({ NODE_ENV: 'development', BROKER_RELEVANCE: 'everyone' })).toThrow(/BROKER_RELEVANCE/);
  });

  it('requires an API key and inbound domain for real sending', () => {
    expect(() => loadConfig({ NODE_ENV: 'development', MAIL_MODE: 'resend' })).toThrow(/RESEND_API_KEY/);
    expect(() => loadConfig({ NODE_ENV: 'development', MAIL_MODE: 'resend', RESEND_API_KEY: 're_x' })).toThrow(/INBOUND_DOMAIN/);
    expect(loadConfig({ NODE_ENV: 'development', MAIL_MODE: 'resend', RESEND_API_KEY: 're_x', INBOUND_DOMAIN: 'in.x.it' }).mailMode).toBe('resend');
  });

  it('rejects a wrong key length, invalid numbers and sameSite=none without secure', () => {
    expect(() => loadConfig({ NODE_ENV: 'development', DATA_ENCRYPTION_KEY: 'AAAA' })).toThrow(/32 bytes/);
    expect(() => loadConfig({ NODE_ENV: 'development', PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ NODE_ENV: 'development', COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' })).toThrow(/SECURE/);
  });

  it('validates the optional capabilities', () => {
    expect(() => loadConfig({ NODE_ENV: 'development', SMS_PROVIDER: 'carrier-pigeon' })).toThrow(/SMS_PROVIDER/);
    expect(() => loadConfig({ NODE_ENV: 'development', SMS_PROVIDER: 'twilio' })).toThrow(/TWILIO_ACCOUNT_SID/);
    expect(() => loadConfig({ NODE_ENV: 'development', FEATURES_DISABLED: 'sender,teleport' })).toThrow(/teleport/);
    expect(() => loadConfig({ NODE_ENV: 'development', TSA_URL: 'ftp://tsa.example' })).toThrow(/TSA_URL/);
    const c = loadConfig({ NODE_ENV: 'development', FEATURES_DISABLED: 'Sender, leaderboard', TSA_URL: 'https://tsa.example/tsr', HAVEIBEENPWNED_API_KEY: 'k', SMS_PROVIDER: 'dry-run' });
    expect(c.featuresDisabled).toEqual(['sender', 'leaderboard']);
    expect(c.identityRequirePhone).toBe(true);
    expect(computeFeatures(c)).toEqual({
      senderSmtp: false,
      dossier: true,
      dossierTimestamp: true,
      accessRequests: true,
      identityPhone: true,
      breachCheck: true,
      delisting: true,
      leaderboard: false,
      nuisance: true,
    });
    const bare = computeFeatures(loadConfig({ NODE_ENV: 'development' }));
    expect(bare).toMatchObject({ dossierTimestamp: false, identityPhone: false, breachCheck: false, senderSmtp: true });
  });
});
