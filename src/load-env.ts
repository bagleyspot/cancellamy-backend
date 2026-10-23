import { existsSync } from 'fs';

// Development convenience: read `.env` from the working directory when present. Variables already set in the
// environment win, and production never reads the file (use real environment variables / Secret Manager).
if (process.env.NODE_ENV !== 'production' && existsSync('.env')) {
  process.loadEnvFile('.env');
}
