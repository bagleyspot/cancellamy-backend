# 5 · Installazione e configurazione

## Requisiti

| Componente | Versione |
|---|---|
| Node.js | 20 o superiore (sviluppato e testato con 22) |
| npm | 10 o superiore (il lockfile è prodotto con npm 11) |
| MongoDB | 6 o superiore (testato con 7 e 8) |
| Redis | 7 o superiore / Redis Cloud (richiesto per le code asincrone BullMQ e l'invio scaglionato) |
| Docker | Facoltativo (database locale, immagini di produzione) |
| Resend | Solo per l'invio reale: account, dominio di invio e dominio di ricezione |

## Struttura dei repository fratelli (Obbligatoria)

Cancellamy è composto da due repository indipendenti che **devono risiedere affiancati nella stessa cartella genitore**:

```
cancellamy-workspace/
  ├── cancellamy-backend/    # API NestJS, MongoDB, Scheduler, Registro broker
  ├── cancellamy-frontend/   # Applicazione web React 19 / Vite / Tailwind
  ├── start-dev.sh           # Script di bootstrap e avvio rapido unificato
  └── Makefile               # Task runner per avvio, test e verifiche
```

### Perché devono essere affiancati?
1. **Docker Compose & Self-Hosting:** La configurazione di deploy `cancellamy-backend/selfhost/docker-compose.yml` compila l'immagine del frontend direttamente da `../../cancellamy-frontend`.
2. **Contratto API TypeScript:** Il frontend importa e mantiene allineate le definizioni dei tipi API (`docs/api-types.ts` <-> `src/api/types.ts`).
3. **Sviluppo integrato:** Il dev-server Vite (`localhost:5173`) inoltra automaticamente le chiamate `/api` al backend (`localhost:3010`), consentendo di lavorare a schermo intero senza configurare CORS o reverse proxy manuali.

Per clonarli entrambi:
```bash
mkdir cancellamy-workspace && cd cancellamy-workspace
git clone https://github.com/bagleyspot/cancellamy-backend.git
git clone https://github.com/bagleyspot/cancellamy-frontend.git
```

---

## Avvio Rapido (Consigliato: 30 secondi)

Dalla cartella principale del workspace o dall'interno di `cancellamy-backend`:

```bash
# Con il Makefile:
make dev

# Oppure direttamente con lo script:
./start-dev.sh

# Oppure con npm dall'interno di cancellamy-backend:
cd cancellamy-backend && npm run dev:all
```

Lo script `start-dev.sh` esegue automaticamente:
1. Controllo della struttura dei repository e delle versioni di Node/npm.
2. Installazione automatica di `node_modules` se non presenti.
3. Test di connettività verso MongoDB (con fallback automatico su un demone locale su porta 27099 o Docker).
4. Avvio contemporaneo del backend su porta `3010` e del frontend su `5173`.
5. Gestione trasparente di `Ctrl+C` per arrestare tutti i processi in background senza lasciare porte orfane occupate.

Dashboard e URL disponibili:
- **Frontend Web App:** [http://127.0.0.1:5173](http://127.0.0.1:5173)
- **Backend API:** [http://127.0.0.1:3010/api/v1](http://127.0.0.1:3010/api/v1)
- **Documentazione Swagger:** [http://127.0.0.1:3010/api/docs](http://127.0.0.1:3010/api/docs)
- **Health Check:** [http://127.0.0.1:3010/health/ready](http://127.0.0.1:3010/health/ready)

---

## Avvio manuale (Terminali separati)

Se preferisci controllare singolarmente i processi in finestre di terminale separate:

```bash
# 1. Database
cd cancellamy-backend
docker compose up -d mongo          # oppure usa Atlas/Mongo locale impostando MONGODB_URI

# 2. Backend
cp .env.example .env                # poi modifica almeno i segreti se necessario
npm install
npm run start:dev                   # API su http://localhost:3010/api/v1 (o PORT configurata)

# 3. Frontend (in un altro terminale)
cd ../cancellamy-frontend
npm install
npm run dev                         # http://localhost:5173, inoltra /api al backend
```

Genera i segreti:

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 32   # DATA_ENCRYPTION_KEY
```

> ⚠️ **Fai un backup di `DATA_ENCRYPTION_KEY`.** Se la perdi, i dati personali cifrati nel database non sono più
> leggibili. Non esiste una procedura di recupero.

Se la porta 3000 o 5173 è già occupata: imposta `PORT` nel backend e, per il frontend, `VITE_PROXY_TARGET` (ad
esempio `VITE_PROXY_TARGET=http://localhost:3010 npm run dev`).

In sviluppo `src/load-env.ts` legge `.env` se esiste; in produzione si usano solo le variabili d'ambiente reali.

### Primo accesso e amministratore

1. Registrati dall'applicazione.
2. In modalità prova l'email di verifica non viene spedita. Imposta `LOG_LEVEL=debug`: il corpo delle email di
   sistema compare nel log del backend, con il link `…/verifica-email?token=…`. Aprilo nel browser.
3. Per avere un amministratore, elenca la sua email in `ADMIN_EMAILS` **prima** della registrazione: chi si registra
   con quell'indirizzo diventa admin e vede il menu **Amministrazione**.

### Provare il flusso completo senza inviare nulla

Crea un profilo, firma la delega e attivalo. Le richieste vengono "inviate" in modalità prova (etichetta **Prova**).
Dalla pagina di una richiesta usa **Simula una risposta del broker** per vedere cambiare stato, cronologia e
notifiche. Per vedere scadenze e solleciti serve far trascorrere il tempo: i test automatici lo fanno con un
orologio simulato (vedi [Sviluppo](./11-sviluppo-e-contributi.md)).

## Variabili d'ambiente (backend)

Tutte opzionali in sviluppo; in produzione i segreti sono obbligatori. Il file `.env.example` ne contiene un campione
e la validazione è in `src/config/app-config.ts` (l'avvio fallisce con un messaggio chiaro se qualcosa non va).

### Server e database

| Variabile | Predefinito | Descrizione |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` o `production` |
| `PORT` | `3000` | Porta HTTP (Cloud Run la imposta da sé) |
| `LOG_LEVEL` | `info` | Livello dei log (`debug` mostra le email in modalità prova) |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/cancellamy` | Connessione a MongoDB |
| `TRUST_PROXY` | `false` | `true` dietro un proxy/balancer, per leggere l'IP reale |

### Segreti

| Variabile | Descrizione |
|---|---|
| `JWT_ACCESS_SECRET` | Firma dei token di accesso, almeno 32 caratteri. **Obbligatorio in produzione** |
| `DATA_ENCRYPTION_KEY` | Chiave AES-256 in base64 di 32 byte. **Obbligatoria in produzione**, da conservare con cura |
| `RESEND_API_KEY` | Chiave API di Resend (solo con `MAIL_MODE=resend`) |
| `RESEND_WEBHOOK_SECRET` | Segreto di firma del webhook `email.received` (formato `whsec_…`) |
| `CRON_SECRET` | Segreto per `POST /internal/cron/tick` (se vuoto l'endpoint risponde 404) |

### Indirizzi, CORS e cookie

| Variabile | Predefinito | Descrizione |
|---|---|---|
| `APP_URL` | `http://localhost:5173` | URL pubblico del frontend (usato nei link delle email) |
| `CORS_ORIGINS` | = `APP_URL` | Origini consentite, separate da virgola |
| `COOKIE_SECURE` | `true` in produzione | Cookie solo HTTPS |
| `COOKIE_SAMESITE` | `lax` | `lax`, `strict` o `none` (`none` richiede `COOKIE_SECURE=true`) |

Il cookie di sessione `cnc_rt` è `HttpOnly`, ha percorso `/api/v1/auth` e dura 30 giorni. Frontend e API devono
risultare **same-site**: la soluzione più semplice è servirli dallo stesso dominio (nginx del frontend con proxy su
`/api/`, vedi [Deploy](./06-deploy.md)).

### Email

| Variabile | Predefinito | Descrizione |
|---|---|---|
| `MAIL_MODE` | `dry-run` | `dry-run`: registra senza inviare. `resend`: invio reale con Resend. `mailbox`: invio reale **solo dalla casella dell'utente** (SMTP o Gmail), senza Resend: pensata per l'uso in locale, vedi [Uso in locale senza Resend](#uso-in-locale-senza-resend) |
| `SEND_SELECTION` | `manual` con `mailbox`, `auto` altrimenti | `manual`: le richieste email nascono come bozze "Da inviare" e le scegli tu (al massimo 10 per volta). `auto`: in coda e scaglionate automaticamente. Vedi [ciclo di vita](./03-ciclo-di-vita-delle-richieste.md#scegliere-quali-richieste-inviare-send_selection) |
| `MAIL_REDIRECT_TO` | vuoto | Solo con `MAIL_MODE=mailbox`: ogni email destinata a un broker viene invece mandata a questo indirizzo (oggetto `[TEST -> destinatario reale] ...`) |
| `MAIL_FROM` | `Cancellamy <richieste@example.org>` | Mittente (deve appartenere a un dominio verificato su Resend) |
| `SUPPORT_EMAIL` | `supporto@example.org` | Indirizzo di supporto mostrato nell'app |
| `INBOUND_DOMAIN` | `in.example.org` | Dominio che riceve le risposte; obbligatorio con `resend` |
| `OPERATOR_NAME` | `Cancellamy (istanza di prova)` | Nome di chi gestisce l'istanza: compare nella delega e nelle email |
| `OPERATOR_ADDRESS` | vuoto | Indirizzo dell'operatore |

### Limiti e comportamento

| Variabile | Predefinito | Descrizione |
|---|---|---|
| `MAX_PROFILES_PER_USER` | `5` | Profili per account |
| `CUSTOM_REQUESTS_PER_MONTH` | `10` | Richieste personalizzate al mese per utente |
| `ADMIN_EMAILS` | vuoto | Email (separate da virgola) che diventano admin alla registrazione |
| `THROTTLE_LIMIT` | `120` | Richieste al minuto per IP (generale) |
| `AUTH_THROTTLE_LIMIT` | `10` | Richieste al minuto per IP sugli endpoint di autenticazione |
| `RESPONSE_DEADLINE_DAYS` | `30` | Giorni concessi al broker |
| `REMINDER_INTERVAL_DAYS` | `15` | Distanza tra i solleciti |
| `RENEWAL_DAYS` | `90` | Giorni prima di una nuova verifica dopo la cancellazione |
| `SEND_BATCH_SIZE` | `25` | Email inviate al massimo per giro dello scheduler |
| `RESEND_DAILY_LIMIT` | `100` | Quota massima globale di email al giorno con Resend |
| `RESEND_MONTHLY_LIMIT` | `3000` | Quota massima globale di email al mese con Resend |
| `RESEND_SYSTEM_RESERVE` | `5` | Posti giornalieri riservati a email critiche di sistema (verifiche/reset) |
| `USER_DAILY_REQUEST_LIMIT` | `5` | Massimo numero di richieste automatiche inviate al giorno per singolo utente |
| `SEED_ON_BOOT` | `true` | Carica/aggiorna il registry all'avvio |
| `BROKER_RELEVANCE` | `prioritize` | Come si scelgono i soggetti per un nuovo profilo: `prioritize` (pertinenti per primi, altri mercati per ultimi, mercato ignoto mai), `strict` (solo i pertinenti), `off` (tutti, come prima). Vedi [ciclo di vita](./03-ciclo-di-vita-delle-richieste.md#quali-soggetti-riceve-un-profilo) |
| `REGISTRY_PATH` | `registry/brokers.yaml` | Percorso del file del registry |

### Scheduler

| Variabile | Predefinito | Descrizione |
|---|---|---|
| `SCHEDULER_ENABLED` | `true` | Timer interno. Mettilo a `false` se usi Cloud Scheduler |
| `SCHEDULER_INTERVAL_SECONDS` | `60` | Frequenza del timer interno (minimo 5) |

### Coda asincrona e rate limiting (BullMQ + Redis)

Le richieste email vengono inserite nella coda `request-dispatch` gestita con BullMQ e Redis per evitare picchi e garantire un invio uniforme a scaglioni.

| Variabile | Predefinito | Descrizione |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Stringa di connessione Redis completa (con credenziali se necessarie) |
| `REDIS_HOST` | `localhost` | Host Redis |
| `REDIS_PORT` | `6379` | Porta Redis |
| `REDIS_USERNAME` | `default` | Utente Redis |
| `REDIS_PASSWORD` | vuota | Password di autenticazione Redis (da impostare solo nel tuo `.env`, mai nel repository) |
| `REDIS_TLS` | `false` | Se abilitare TLS per la connessione Redis |
| `QUEUE_ENABLED` | `true` (in test: `false`) | Abilita la coda e i worker BullMQ per il recapito asincrono |

### Funzioni opzionali

Tutte spente finché non le configuri; l'interfaccia nasconde da sola ciò che non è disponibile (`GET /config` →
`features`). Dettagli in [Funzionalità avanzate](./12-funzionalita-avanzate.md).

| Variabile | Predefinito | Descrizione |
|---|---|---|
| `FEATURES_DISABLED` | vuoto | Elenco, separato da virgole, di funzioni da spegnere: `sender`, `dossier`, `access`, `delisting`, `leaderboard`, `nuisance`, `breach`. Un nome sconosciuto blocca l'avvio |
| `HAVEIBEENPWNED_API_KEY` | vuoto | Chiave di Have I Been Pwned: attiva il controllo delle violazioni (altrimenti nascosto) |
| `HIBP_USER_AGENT` | `Cancellamy` | User-Agent inviato a HIBP (richiesto dal servizio) |
| `HIBP_REQUEST_INTERVAL_MS` | `6500` | Pausa tra due interrogazioni (limite del piano del servizio) |
| `BREACH_RECHECK_DAYS` | `30` | Ogni quanto si ripete il controllo di una email |
| `SMS_PROVIDER` | `none` | `none`, `dry-run` (solo log) o `twilio`: abilita la verifica dei telefoni |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | vuoto | Obbligatori con `SMS_PROVIDER=twilio` |
| `IDENTITY_REQUIRE_PHONE` | `true` se c'è un fornitore SMS | Se attivo, per l'identità verificata servono anche i telefoni del profilo |
| `TSA_URL` | vuoto | Autorità di marcatura temporale RFC 3161 per il dossier (es. `https://freetsa.org/tsr`). Solo l'impronta viene inviata |
| `LEADERBOARD_MIN_USERS` | `20` | Utenti distinti minimi perché un broker compaia nella classifica pubblica |
| `ATTACHMENT_RETENTION_DAYS` | `30` | Per quanto si conservano (cifrati) gli allegati ricevuti dai broker |
| `MAX_ATTACHMENT_BYTES` | `10485760` | Dimensione massima di un allegato ricevuto da conservare |
| `SMTP_ALLOW_PRIVATE_HOSTS` | `false` | Solo sviluppo e test: consente server SMTP in rete privata e qualsiasi porta |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | vuoti | Client OAuth Google per "Collega con Google" (vanno impostati insieme; vuoti = funzione spenta). Vedi [12 · Funzionalità avanzate](./12-funzionalita-avanzate.md#collegare-gmail-con-google-oauth) |
| `GOOGLE_OAUTH_REDIRECT_URI` | `<APP_URL>/app/collega-google` | URI di reindirizzamento registrato nel client OAuth Google |

## Variabili del frontend

| Variabile | Predefinito | Descrizione |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | Base URL dell'API. Tienila same-origin |
| `VITE_PROXY_TARGET` | `http://localhost:3000` | Solo in sviluppo: dove il server Vite inoltra `/api` |
| `VITE_SOURCE_URL` | segnaposto GitHub | Repository che serve il codice in esecuzione (obbligo AGPL §13), mostrato nel footer |

## Attivare l'invio reale con Resend

1. **Dominio di invio.** In Resend verifica un dominio (record SPF e DKIM) e imposta `MAIL_FROM` con un indirizzo di
   quel dominio.
2. **Dominio di ricezione.** Abilita la ricezione (inbound) per un dominio o sottodominio (ad esempio
   `in.example.org`) e impostalo in `INBOUND_DOMAIN`. Le risposte dei broker arrivano a `r-<token>@INBOUND_DOMAIN`.
3. **Webhook.** Crea un webhook per l'evento `email.received` verso `https://<tuo-api>/api/v1/webhooks/resend` e
   copia il segreto di firma in `RESEND_WEBHOOK_SECRET`. Le firme sono verificate (Standard Webhooks, tolleranza di
   5 minuti) e le consegne sono deduplicate.
4. **Chiave API.** Imposta `RESEND_API_KEY` e `MAIL_MODE=resend`.
5. **Prima prova.** Con un tuo profilo e un solo broker abilitato (area admin), controlla che l'email arrivi e che
   una tua risposta a `r-…@INBOUND_DOMAIN` compaia nella richiesta. Prima di attivare tutti i broker, rileggi il
   registry.

Con `MAIL_MODE=resend` il pulsante di simulazione delle risposte è disattivato (`SIMULATION_DISABLED`).

## Uso in locale senza Resend

Per provare l'invio vero sul proprio computer non serve Resend né un dominio: usa `MAIL_MODE=mailbox`.

- **Chi invia:** solo la casella dell'utente, collegata dalla scheda *Mittente delle email* del profilo (SMTP con password per
  le app, oppure *Collega con Google*). Un profilo senza casella collegata non invia: le sue richieste restano in attesa e
  l'app mostra "This instance only sends from your own mailbox".
- **Risposte:** non c'è alias né webhook. Senza `Reply-To`, i broker rispondono all'indirizzo dell'utente, nella sua casella;
  l'esito di ogni richiesta si segna dall'app (*Segna l'esito*). Resta l'intestazione `X-Cancellamy-Ref` e il codice `CNC-…`
  nell'oggetto per riconoscerle.
- **Email di sistema** (conferma account, notifiche): non vengono inviate; il link o il codice compare nel log del backend
  (con `LOG_LEVEL=debug`).
- **Provare senza scrivere a nessuno:** imposta `MAIL_REDIRECT_TO=tuo@indirizzo`. Ogni email "ai broker" arriva a quell'indirizzo
  con oggetto `[TEST -> privacy@broker.example] ...` e intestazione `X-Original-To`. Per l'invio reale togli la variabile.
- **Attenzione:** attivando un profilo si pianificano centinaia di richieste (5 al giorno per utente, la prima subito). Con
  `MAIL_REDIRECT_TO` vuoto partono davvero verso i broker.


Limiti del fornitore: l'API di Resend consente circa 2 richieste al secondo; lo scheduler rallenta di 600 ms tra un
invio e l'altro in modalità reale.

### Gestione quote e prevenzione monopolio (Fair-Share)

Cancellamy integra un sistema automatico di controllo quote (`MailQuotaService`):

1. **Quote Resend globali:**
   - **Giornaliera:** Massimo 100 email al giorno (`RESEND_DAILY_LIMIT=100`).
   - **Mensile:** Massimo 3000 email al mese (`RESEND_MONTHLY_LIMIT=3000`).
   - **Riserva email di sistema:** 5 email al giorno sono riservate per verifiche account e recupero password (`RESEND_SYSTEM_RESERVE=5`). Le richieste massive si arrestano automaticamente a 95 email/giorno, impedendo il blocco dell'accesso per gli utenti.

2. **Scaglionamento e limite per utente (Fair-Share):**
   - Ogni utente ha un limite di **5 richieste automatiche al giorno** (`USER_DAILY_REQUEST_LIMIT=5`).
   - Quando un utente attiva un profilo con centinaia di broker (es. ~368 broker verificati), le richieste email vengono create con date programmate a scaglioni giornalieri progressivi (le prime 5 oggi, le successive 5 domani, ecc.).
   - Il runtime dello scheduler verifica atomicamente i volumi inviati dall'utente: se un utente ha già raggiunto le 5 richieste odierne, i suoi task residui vengono posticipati al giorno successivo, consentendo allo scheduler di servire gli altri utenti della piattaforma.

**Perché questa limitazione è fondamentale:**
- **Zero superamento quote:** Protegge dalle tariffe extra o dalla sospensione dell'account Resend Free.
- **Anti-monopolizzazione:** Nessun singolo utente può consumare in pochi minuti l'intero budget giornaliero del server a scapito degli altri.
- **Reputazione del dominio (deliverability):** Evita picchi improvvisi di centinaia di email che farebbero finire il dominio mittente nelle blacklist antispam dei broker.

## Verifica dell'installazione

```bash
curl localhost:3000/health            # {"status":"ok"}
curl localhost:3000/health/ready      # {"status":"ok","mongo":"up"}
curl localhost:3000/api/v1/config     # mailMode, numero broker, limiti
```

All'avvio il backend carica il registry: nel log trovi "registry seeded: N created, M updated".
