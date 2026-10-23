import { join } from 'path';

// Must run before any application module is imported (some decorators read env at import time).
const base = process.env.E2E_MONGODB_URI ?? 'mongodb://127.0.0.1:27099';
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = `${base.replace(/\/$/, '')}/cancellamy_e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
process.env.THROTTLE_LIMIT = '100000';
process.env.AUTH_THROTTLE_LIMIT = '100000';
process.env.SCHEDULER_ENABLED = 'false';
process.env.REGISTRY_PATH = join(__dirname, 'fixtures', 'brokers.test.yaml');
process.env.ADMIN_EMAILS = 'admin@example.org';
process.env.RESEND_API_KEY = 're_test_key';
process.env.RESEND_WEBHOOK_SECRET = 'whsec_' + Buffer.from('cancellamy-test-webhook-secret-32b').toString('base64');
process.env.INBOUND_DOMAIN = 'in.example.org';
process.env.MAIL_FROM = 'Cancellamy <richieste@example.org>';
process.env.CUSTOM_REQUESTS_PER_MONTH = '2';
process.env.MAX_PROFILES_PER_USER = '3';
process.env.APP_URL = 'http://localhost:5173';
process.env.MAIL_MODE = 'dry-run';
process.env.SMTP_ALLOW_PRIVATE_HOSTS = 'true';
process.env.HIBP_REQUEST_INTERVAL_MS = '0';
process.env.LEADERBOARD_MIN_USERS = '3';
delete process.env.HAVEIBEENPWNED_API_KEY;
delete process.env.TSA_URL;
delete process.env.SMS_PROVIDER;
delete process.env.FEATURES_DISABLED;
delete process.env.CRON_SECRET;
