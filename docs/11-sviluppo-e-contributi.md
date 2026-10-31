# 11 · Sviluppo e contributi

## Ambiente di sviluppo

Vedi [Installazione](./05-installazione-e-configurazione.md) per l'avvio. Comandi del backend:

| Comando | Cosa fa |
|---|---|
| `npm run start:dev` | Avvio con ricarica automatica |
| `npm run build` | Compila in `dist/` |
| `npm run lint` | ESLint (flat config, TypeScript) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Test unitari (nessun database) |
| `npm run test:e2e` | Test end-to-end su MongoDB reale |
| `npm run openapi` | Genera `docs/openapi.json` (serve MongoDB) |

Frontend: `npm run dev`, `lint`, `typecheck`, `test` (Vitest), `build`.

Prima di aprire una pull request devono passare **lint, typecheck, test, build** (e gli e2e per il backend). La CI
(GitHub Actions) li esegue.

## Test

### Backend

- **Unitari** (81, `src/**/*.spec.ts`): classificatore delle risposte (anche quelle di accesso), cifratura, configurazione e
  flag delle funzioni, registry, pianificazione dei canali, macchina a stati, modelli di testo, PDF, trasporti email,
  protezione SSRF, richieste RFC 3161, SMS, normalizzazione dei numeri.
- **End-to-end** (106, `test/*.e2e-spec.ts`): l'applicazione vera via HTTP, con MongoDB reale e un database nuovo per
  file. Coprono: salute e catalogo pubblico, registrazione/login/refresh/reset/blocco, profili e delega, attivazione,
  invio con allegati e lingua, ritentativi, risposte (simulate e dal webhook con firma), documento d'identità,
  notifiche e report, richieste personalizzate, **scadenze, solleciti, reclamo e rinnovi con orologio simulato**,
  admin, esportazione e cancellazione account, endpoint di cron, modalità `resend`, due istanze in parallelo, e le
  funzioni avanzate: **invio da un vero server SMTP in-process** (credenziali rifiutate e riprese, SSRF), dossier con
  verifica delle impronte e marca temporale, verifica dei contatti con limiti, richieste di accesso con allegati cifrati e
  mappa dati, controllo violazioni con API simulata, deindicizzazione, telemarketing, classifica e interruttori delle funzioni.

Per eseguire gli e2e serve un MongoDB: imposta `E2E_MONGODB_URI` (predefinito `mongodb://127.0.0.1:27099`).
Con Docker: `docker run -d -p 27099:27017 mongo:7`. I test non toccano il tuo database di sviluppo: ogni file usa un
database con nome casuale.

Gli e2e sostituiscono il trasporto email con un oggetto che cattura i messaggi (`test/helpers.ts`), quindi non
spediscono nulla. L'orologio (`Clock`) si può far avanzare per simulare i giorni.

### Frontend

163 test (Vitest + Testing Library + msw): client API con refresh sul 401, flusso di accesso, rotte protette,
mappatura stati/gruppi, validazione della procedura guidata (firma uguale al nome), visibilità delle azioni nella
pagina richiesta, banner modalità prova, filtri del catalogo e, per le funzioni avanzate, flag delle funzioni, form del
mittente, verifica dei contatti, accesso e mappa dati, deindicizzazione, telemarketing, classifica, dossier e allegati.

## Convenzioni

- **TypeScript strict**, niente `any` in `src/`. Codice, commenti e commit in inglese; i testi dell'interfaccia in
  italiano in `src/i18n/it.ts`.
- **Dati personali:** passano da `CryptoService`, non si scrivono nei log, non entrano in indici.
- **Idempotenza:** ogni operazione ripetibile (scheduler, webhook, invio) deve poter essere eseguita due volte senza
  effetti doppi. Usa riserve atomiche (`findOneAndUpdate`), indici univoci e chiavi di idempotenza.
- **Transizioni di stato** solo tramite `RequestEngine.transition` (valida con `status.ts`).
- **Un test e2e** per ogni nuovo comportamento visibile via HTTP.
- Non indebolire: modalità prova predefinita, invio solo a voci `verified`, DMARC fallito → posta non abbinata.

## Come estendere

### Aggiungere un soggetto al registry

Vedi [Registry → Come contribuire](./04-registry.md#come-contribuire).

### Migliorare la classificazione delle risposte

Modifica i modelli in `src/requests/reply-classifier.ts` (ordine: ricevuta automatica → documento richiesto →
rifiuto → completato → altre informazioni). Aggiungi il caso in `reply-classifier.spec.ts`. Ricorda che il testo
citato viene rimosso prima della classificazione e che le negazioni vincono sulle frasi positive.

### Aggiungere un canale di contatto

La scelta del canale è in `src/requests/channel-plan.ts`. Per un nuovo tipo servono: il tipo in `registry.ts`
(`CHANNEL_TYPES`) e nello schema `BrokerChannel`, la logica in `planChannel`, i testi in
`src/templates/request-templates.ts` e i test relativi.

### Aggiungere un endpoint

1. Controller e servizio nel modulo giusto (`DomainModule`); DTO con `class-validator` (i campi extra sono rifiutati).
2. Se è protetto, nessuna annotazione: l'autenticazione è globale. Per i pubblici usa `@Public()`, per gli admin
   `@Roles('admin')`.
3. Aggiorna `docs/api-types.ts` e `docs/API-CONTRACT.md` (poi `npm run openapi`) e il frontend (`src/api/types.ts` è
   una copia identica).
4. Scrivi il test e2e.

### Aggiungere una lingua dei testi ai broker

I testi sono in `src/templates/request-templates.ts` (italiano e inglese). Aggiungi la variante e la regola di
scelta della lingua in `RequestEngine.lang`.

### Cambiare il fornitore email

Implementa `MailTransport` (`src/mail/mail.types.ts`) e collegalo in `MailModule`. La ricezione delle risposte è nel
modulo `inbound`: serve un webhook equivalente che chiami `InboundService.processInbound`.

## Struttura dei test e2e (per orientarsi)

| File | Argomento |
|---|---|
| `auth.e2e-spec.ts` | Salute, catalogo, registrazione, sessioni, reset, blocco |
| `profiles.e2e-spec.ts` | Profili, delega, PDF, attivazione, pausa, revoca |
| `requests.e2e-spec.ts` | Invio, manuale, riepilogo, filtri, ritentativi |
| `lifecycle.e2e-spec.ts` | Risposte, documento, notifiche, report, personalizzate, scadenze e rinnovi |
| `inbound.e2e-spec.ts` | Webhook: firme, abbinamento, citazioni, posta non abbinata |
| `admin-account.e2e-spec.ts` | Admin, export/cancellazione account, due istanze, cron, modalità `resend` |
| `sender.e2e-spec.ts` | Invio dalla propria casella con un server SMTP vero, SSRF, modalità prova |
| `gmail.e2e-spec.ts` | "Collega con Google" contro un finto Google (token, PKCE, invio, revoca), richieste in attesa se l'accesso è revocato |
| `dossier.e2e-spec.ts` | Dossier, impronte, marca temporale RFC 3161 |
| `identity-access.e2e-spec.ts` | Verifica dei contatti, richieste di accesso, esiti, mappa, allegati |
| `breaches.e2e-spec.ts` | Controllo violazioni con API simulata |
| `delistings-nuisance.e2e-spec.ts` | Deindicizzazione e difesa dal telemarketing |
| `leaderboard.e2e-spec.ts` | Classifica pubblica e soglia di privacy |

## Roadmap e idee aperte

Funzioni che il progetto non ha ancora e dove avrebbe senso lavorare:

- **Verifica dell'identità** più forte (SPID/CIE o documento): oggi si prova solo il possesso di email e telefoni.
- **OAuth Gmail/Outlook** per l'invio dalla propria casella (oggi solo SMTP con password per le app); richiede la verifica dell'app presso Google e Microsoft.
- **Script di rotazione** della `DATA_ENCRYPTION_KEY` e **conservazione automatica** dei dati.
- **Più broker verificati**: ogni contributo al registry vale più di una nuova funzione.
- **Moduli web automatizzati** (oggi sono azioni guidate manuali).
- **Anteprima PDF** della delega prima della firma, notifiche push/PWA e promemoria in calendario.
- **Estensione del browser** per precompilare i moduli web dei broker (oggi azioni guidate a mano).
- **Lingua inglese** dell'interfaccia (oggi solo italiano).
- Versione della bozza di reclamo con la verifica di un legale, e strumenti per presentarla.

## Questioni note di contratto e interfaccia

- Il `refresh` non restituisce l'utente: l'app chiama `/me` dopo ogni refresh.
- La procedura guidata del profilo è divisa su due rotte (dati e contatti, poi delega e attivazione).
- Le regole di validazione dei campi (codice fiscale, telefono, CAP) sono definite lato backend; il frontend le
  rispecchia e potrebbe essere più restrittivo in alcuni formati.
- Elenco completo e ragionamento: `cancellamy-frontend/docs/FRONTEND-NOTES.md`.

## Repository, protezioni e rilasci (per i maintainer)

Entrambi i repository (`cancellamy-backend`, `cancellamy-frontend`) hanno le stesse regole:

- **`main` è protetto da un ruleset senza bypass** (vale anche per gli admin): serve una pull request, merge solo
  *squash*, cronologia lineare, firma dei commit (li firma GitHub al merge), conversazioni risolte, nessun force-push né
  cancellazione, branch aggiornato rispetto a `main` e tutti i check obbligatori verdi. Non sono richieste approvazioni
  (progetto con un solo maintainer), ma `CODEOWNERS` assegna la review.
- **Titolo della PR = messaggio di commit su `main`**: deve seguire Conventional Commits (`feat:`, `fix:`, `docs:`,
  `registry:`...). Il check «PR title» lo verifica.
- **Check obbligatori**: lint/typecheck/unit, e2e con MongoDB (solo backend), build, licenze delle dipendenze, build e
  scansione Trivy dell'immagine Docker, CodeQL, dependency review, scansione segreti (gitleaks), lint dei workflow
  (actionlint e zizmor). In più, non bloccanti: OpenSSF Scorecard e controllo dei link.
- **Sicurezza GitHub**: secret scanning con push protection, Dependabot (alert, security updates e aggiornamenti
  settimanali; i major si decidono a mano), segnalazioni private delle vulnerabilità, token dei workflow in sola
  lettura, solo azioni autorizzate e fissate per SHA, tag `v*` immutabili.
- **Rilasci**: [release-please](https://github.com/googleapis/release-please) tiene aperta una PR di rilascio generata
  dai titoli dei commit. Fondendola si crea tag e release e il workflow pubblica l'immagine su
  `ghcr.io/bagleyspot/<repo>` (multi-architettura, con attestazione di provenienza e SBOM). Le PR create con il
  `GITHUB_TOKEN` non avviano gli altri workflow: per far partire i check sulla PR di rilascio chiudila e riaprila,
  oppure aggiungi il secret `RELEASE_PLEASE_TOKEN` (token fine-grained con permessi contents e pull-requests).
- **Branch di lavoro**: i branch si cancellano da soli dopo il merge.

## Licenza e contributi

Codice: AGPL-3.0-only; dati del registry (`registry/`): CC BY-SA 4.0. Chi esegue una versione modificata come servizio di rete deve offrire il codice sorgente agli
utenti (sezione 13): mantieni il link "Codice sorgente" del footer puntato al tuo repository (`VITE_SOURCE_URL`).
Contribuendo accetti che il codice sia rilasciato con la stessa licenza e i dati del registry con CC BY-SA 4.0. Vedi anche `CONTRIBUTING.md` e
`SECURITY.md`.
