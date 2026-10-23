# Self-hosting Cancellamy

One command brings up MongoDB, the API and the web app.

```bash
cd selfhost
cp selfhost.env.example .env      # set JWT_ACCESS_SECRET and DATA_ENCRYPTION_KEY at least
docker compose up -d --build      # http://localhost:8080
```

- Emails are only recorded until you set `MAIL_MODE=resend` (see `docs/05-installazione-e-configurazione.md`).
- Put a TLS-terminating reverse proxy (Caddy, Traefik, your cloud load balancer) in front, then set `APP_URL` to the
  public https URL and `COOKIE_SECURE=true`.
- Back up the `mongo-data` volume **and** `DATA_ENCRYPTION_KEY`.
- The web container proxies `/api` to the API, so the session cookie stays first-party.
- Every optional capability is off unless configured: see the variables in `selfhost.env.example`.

The frontend repository is expected next to this one; use `FRONTEND_CONTEXT=/path/to/cancellamy-frontend` otherwise.
