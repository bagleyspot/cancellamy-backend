# 8 · API

L'API è REST/JSON. Fonti di verità:

- [`api-types.ts`](./api-types.ts): tutti i tipi di richiesta e risposta;
- [`API-CONTRACT.md`](./API-CONTRACT.md): endpoint, regole e mappatura schermate → API;
- [`openapi.json`](./openapi.json): specifica OpenAPI generata (`npm run openapi`);
- Swagger UI su `/api/docs` (disabilitato in produzione).

Base: `/api/v1`. Fanno eccezione `GET /health`, `GET /health/ready` e `POST /internal/cron/tick` (senza prefisso).
Le date sono stringhe ISO-8601 in UTC. Gli elenchi sono paginati: `?page=1&limit=20` (massimo 100) e restituiscono
`{ items, total, page, limit }`.

## Autenticazione

1. `POST /auth/register` o `POST /auth/login` restituiscono `{ user, accessToken }` e impostano il cookie `cnc_rt`.
2. Invia `Authorization: Bearer <accessToken>` (valido 15 minuti).
3. Alla scadenza chiama `POST /auth/refresh` con il cookie (`credentials: 'include'`): ottieni un nuovo token di
   accesso e il cookie ruotato.
4. `POST /auth/logout` cancella il cookie e revoca la sessione.

```bash
# registrazione e uso del token
curl -s -c jar.txt -X POST localhost:3000/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"mario@example.it","password":"una-password-lunga","acceptTerms":true}'

# (dopo aver confermato l'email) elenco richieste
curl -s localhost:3000/api/v1/requests?group=action_required \
  -H "authorization: Bearer $TOKEN"

# rinnovo del token di accesso
curl -s -b jar.txt -c jar.txt -X POST localhost:3000/api/v1/auth/refresh
```

## Errori

Formato unico:

```json
{ "statusCode": 409, "error": "Conflict", "message": "Cannot move a request from completed to sent", "code": "INVALID_STATE" }
```

Gli errori di validazione sono `400` con `message` come elenco di stringhe e `code: "VALIDATION_ERROR"`. Campi
non previsti nel corpo vengono rifiutati.

| Codice | Quando |
|---|---|
| `EMAIL_NOT_VERIFIED` | Operazione che richiede l'email confermata (creare o attivare profili) |
| `EMAIL_TAKEN` | Registrazione con un'email già usata |
| `INVALID_CREDENTIALS` | Password errata (login, cambio password, eliminazione account) |
| `INVALID_TOKEN` | Token di verifica o reset non valido o scaduto |
| `PROFILE_LIMIT_REACHED` | Raggiunto il massimo di profili |
| `AUTHORIZATION_REQUIRED` | Serve la delega firmata |
| `PROFILE_NOT_READY` | Attivazione o richiesta personalizzata con profilo non pronto |
| `INVALID_STATE` | Transizione di stato non consentita |
| `CUSTOM_LIMIT_REACHED` | Limite mensile di richieste personalizzate |
| `SIMULATION_DISABLED` | Simulazione richiesta fuori dalla modalità prova |
| `SMTP_CONNECTION_FAILED` | La casella dell'utente rifiuta la connessione o le credenziali (il messaggio spiega cosa controllare) |
| `SMTP_HOST_NOT_ALLOWED` | Server SMTP privato o porta non ammessa |
| `IDENTITY_REQUIRED` | Serve la verifica dei contatti del profilo (richieste di accesso) |
| `VERIFICATION_CODE_INVALID` | Codice di verifica errato o scaduto |
| `VERIFICATION_RATE_LIMITED` | Troppi codici richiesti o troppi tentativi (`429`) |
| `FEATURE_DISABLED` | Funzione spenta o non configurata su questa istanza (`404`, o `400` per la marca temporale) |
| `TIMESTAMP_UNAVAILABLE` | L'autorità di marcatura temporale non risponde (`502`) |
| `RATE_LIMITED` | Troppe richieste (`429`) |

Altri stati: `401` senza o con token non valido, `403` ruolo insufficiente, `404` risorsa inesistente **o di un altro
utente** (non si distingue), `413` file oltre 5 MB, `503` fornitore non raggiungibile.

## Riferimento degli endpoint

### Account

| Metodo | Percorso | Note |
|---|---|---|
| POST | `/auth/register` | `201`; invia l'email di verifica |
| POST | `/auth/login` | |
| POST | `/auth/refresh` | Cookie |
| POST | `/auth/logout` | `204` |
| POST | `/auth/verify-email` | Corpo `{ token }`, `204` |
| POST | `/auth/resend-verification` | Autenticato, `204` |
| POST | `/auth/forgot-password` | Risponde sempre `204` |
| POST | `/auth/reset-password` | Revoca tutte le sessioni |
| GET | `/me` | |
| PATCH | `/me` | Impostazioni (`notifyByEmail`, `monthlyReport`) |
| POST | `/me/change-password` | Mantiene la sessione corrente, revoca le altre |
| GET | `/me/export` | Tutti i dati in chiaro, file JSON |
| DELETE | `/me` | Corpo `{ password }`; cancellazione definitiva |

### Profili

| Metodo | Percorso | Note |
|---|---|---|
| GET, POST | `/profiles` | Elenco e creazione |
| GET, PATCH, DELETE | `/profiles/:id` | Cancellare elimina anche richieste e messaggi |
| GET | `/profiles/:id/authorization/text` | Testo della delega con il nome già inserito |
| POST | `/profiles/:id/authorization` | Firma: `{ signatureName, accepted: true }` |
| GET | `/profiles/:id/authorization/pdf` | PDF firmato |
| DELETE | `/profiles/:id/authorization` | Revoca |
| POST | `/profiles/:id/activate` | `{ emailRequests, manualActions }` |
| POST | `/profiles/:id/pause`, `/resume` | |

### Richieste

| Metodo | Percorso | Note |
|---|---|---|
| GET | `/requests` | Filtri: `profileId`, `group`, `status`, `category`, `q`, `page`, `limit` |
| GET | `/requests/summary` | Contatori, copertura, andamento, attività recente |
| GET | `/requests/:id` | Dettaglio con cronologia, messaggi, istruzioni manuali e flag di azione |
| POST | `/requests/custom` | Richiesta personalizzata |
| POST | `/requests/:id/mark-done` | Azione manuale completata |
| POST | `/requests/:id/outcome` | Esito indicato dall'utente |
| POST | `/requests/:id/provide-id` | `multipart/form-data`, campo `file` (PDF/JPG/PNG, max 5 MB) e `note` |
| POST | `/requests/:id/reminder` | Sollecito manuale |
| POST | `/requests/:id/escalate` | Bozza del reclamo; ripetibile |
| GET | `/requests/:id/complaint.pdf` | PDF del reclamo |
| POST | `/requests/:id/cancel` | |
| POST | `/requests/:id/simulate-reply` | Solo modalità prova |

I flag `canRemind`, `canEscalate`, `canProvideId` e `canSimulateReply` del dettaglio indicano quali azioni sono
consentite in quel momento.

### Catalogo pubblico, notifiche, report

| Metodo | Percorso | Note |
|---|---|---|
| GET | `/config` | Pubblico: `mailMode`, limiti, conteggi del registry |
| GET | `/brokers`, `/brokers/stats`, `/brokers/:id` | Pubblici; filtri `q`, `category`, `status`, `sendable` |
| GET | `/notifications`, `/notifications/unread-count` | |
| POST | `/notifications/read` | `{ ids? }`; senza `ids` le segna tutte |
| GET | `/reports` | Filtro `profileId` |
| POST | `/reports/generate` | `{ profileId }` per il mese corrente |

### Funzioni avanzate

Descritte nel capitolo [Funzionalità avanzate](./12-funzionalita-avanzate.md); i tipi sono in `api-types.ts`.

| Metodo | Percorso | Note |
|---|---|---|
| GET, PUT, DELETE | `/profiles/:id/sender` | Mittente delle email (`cancellamy` o `smtp`); la password non è mai restituita |
| POST | `/profiles/:id/sender/test` | Prova la connessione senza inviare nulla |
| GET | `/profiles/:id/identity` | Stato di verifica dei contatti |
| POST | `/profiles/:id/identity/send-code` | Invia il codice (email o SMS); `204` |
| POST | `/profiles/:id/identity/confirm` | Conferma il codice |
| POST | `/requests/access` | Richieste di accesso (art. 15) a più broker; `{ created, skipped }` |
| PUT | `/requests/:id/findings` | Esito di una richiesta di accesso (dati trovati o no, categorie) |
| GET | `/profiles/:id/data-map` | Mappa dei dati per broker e categoria |
| GET | `/requests/:id/messages/:messageId/attachments/:attachmentId` | Scarica un allegato ricevuto (cifrato a riposo, scade) |
| GET | `/requests/:id/dossier.zip?timestamp=true\|false` | Dossier probatorio |
| GET | `/profiles/:id/breaches` | Violazioni delle email verificate (`enabled: false` senza chiave) |
| POST | `/profiles/:id/breaches/check` | Nuovo controllo (`202`, al massimo una volta all'ora) |
| GET, POST | `/delistings` | Elenco e creazione di pratiche di deindicizzazione |
| GET, PATCH, DELETE | `/delistings/:id` | Dettaglio, cambio di stato (transizioni validate), eliminazione |
| GET | `/delistings/:id/guide` | Passi, modulo ufficiale e testo pronto |
| GET | `/brokers/leaderboard?sort=&order=&category=` | **Pubblico**: classifica aggregata (solo broker sopra la soglia) |
| GET, POST | `/nuisance` | Panoramica con stato RPO e contatti indesiderati; nuova annotazione |
| DELETE | `/nuisance/:id` | |
| POST | `/nuisance/complaint` | Bozza di segnalazione al Garante (testo + istruzioni) |
| GET | `/nuisance/complaint.pdf?profileId=` | PDF della segnalazione |

`GET /requests` accetta anche `kind=erasure|access`; `GET /config` restituisce `features` (flag delle funzioni),
`leaderboardMinUsers` e `attachmentRetentionDays`.

### Amministrazione (ruolo `admin`)

| Metodo | Percorso | Note |
|---|---|---|
| GET | `/admin/stats` | Utenti, profili, richieste per stato, messaggi, posta non abbinata |
| GET | `/admin/brokers` | Come il catalogo, con le modifiche |
| PATCH | `/admin/brokers/:id` | `sendEnabled`, `verificationStatus`, `channels`, `notes` |
| POST | `/admin/brokers/reseed` | Ricarica il registry: `{ created, updated }` |
| GET | `/admin/inbound-unmatched` | Posta non abbinata |
| POST | `/admin/inbound-unmatched/:id/assign` | `{ requestId }`: id interno **oppure** riferimento `CNC-…` |
| GET | `/admin/outbox` | Email inviate (o registrate in modalità prova) |

### Infrastruttura

| Metodo | Percorso | Note |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/health/ready` | Ping di MongoDB; `503` se giù |
| POST | `/api/v1/webhooks/resend` | Webhook `email.received` (firma obbligatoria) |
| POST | `/internal/cron/tick` | Header `x-cron-secret`; risponde il riepilogo del giro |

## Esempio: dal profilo alla prima richiesta

```bash
H='content-type: application/json'; A="authorization: Bearer $TOKEN"

# 1. profilo
curl -s -X POST localhost:3000/api/v1/profiles -H "$H" -H "$A" -d '{
  "firstName":"Mario","lastName":"Rossi",
  "emails":["mario.rossi@example.it"],"phones":[],
  "addresses":[{"street":"Via Roma 1","city":"Milano","zip":"20100","country":"IT"}],
  "aliases":[]}'

# 2. firma (il nome deve coincidere)
curl -s -X POST localhost:3000/api/v1/profiles/$ID/authorization -H "$H" -H "$A" \
  -d '{"signatureName":"Mario Rossi","accepted":true}'

# 3. attivazione
curl -s -X POST localhost:3000/api/v1/profiles/$ID/activate -H "$A"
# -> {"emailRequests":37,"manualActions":1}   (con il registry iniziale)
```

## Webhook di ricezione

`POST /api/v1/webhooks/resend` accetta l'evento `email.received` firmato (intestazioni `svix-id`, `svix-timestamp`,
`svix-signature`; tolleranza di 5 minuti). Il corpo dell'email non è nell'evento: l'API lo recupera da
`GET https://api.resend.com/emails/receiving/{id}`. Risposte: `200` elaborato o già elaborato, `400` firma non valida,
`503` se il fornitore non risponde (Resend ritenterà).
