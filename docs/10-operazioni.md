# 10 · Operazioni

Guida per chi gestisce un'istanza: cosa controllare, come intervenire, come risolvere i problemi più comuni.

## Cosa monitorare

| Cosa | Dove | Soglia di allarme suggerita |
|---|---|---|
| Disponibilità | `GET /health/ready` (include MongoDB) | Fallisce per più di 2 minuti |
| Errori del server | Log con `severity: ERROR`, risposte 5xx | Qualsiasi picco |
| Giri dello scheduler | Chiamate a `/internal/cron/tick` (Cloud Scheduler) | Nessuna chiamata riuscita da 10 minuti |
| Invii falliti | Log "send failed" / "send permanently failed"; richieste che passano a `action_required` per errore | Più di qualche caso al giorno |
| Posta non abbinata | *Amministrazione → Posta non abbinata* e contatore in *Statistiche* | Elementi fermi da giorni |
| Webhook | Risposte `400`/`503` su `/api/v1/webhooks/resend` | Qualsiasi serie |
| Coda | Richieste `queued` che invecchiano (ultima attività vecchia) | Richieste in coda da oltre un'ora |

Il risultato di ogni giro dello scheduler è nella risposta di `POST /internal/cron/tick`:
`{ ran, synced, sent, retried, failed, overdue, reminders, renewals, reports, breaches, followUps }`
(`followUps` conta i promemoria di deindicizzazione e RPO inviati, `breaches` i controlli di violazioni eseguiti). `ran: false` significa che un'altra
istanza stava già lavorando (normale).

## Area amministrazione

Disponibile agli utenti con ruolo admin (`ADMIN_EMAILS` alla registrazione):

- **Statistiche:** utenti, profili, profili attivi, messaggi inviati e ricevuti, posta non abbinata, richieste per
  stato, modalità email.
- **Broker:** ricerca e filtri; **invio automatico** (interruttore), stato di verifica, note. Le modifiche non
  vengono sovrascritte dal ricaricamento del registry. **Risincronizza il registro** ricarica il file.
- **Posta non abbinata:** messaggi ricevuti che non si sono potuti collegare a una richiesta. Per ciascuno si
  assegna la richiesta indicando il riferimento `CNC-…` (o l'id interno): il messaggio viene applicato come risposta.
- **Posta inviata:** elenco delle email inviate (o registrate in modalità prova) con destinatario e oggetto.

## Procedure ricorrenti

### Abilitare un nuovo broker

1. Verifica il recapito sul sito ufficiale e aggiorna il registry (pull request) oppure modifica la voce dall'area admin.
2. Imposta lo stato su `verified` e attiva **Invio automatico**.
3. Al giro successivo dello scheduler la richiesta viene creata per tutti i profili attivi (`synced`).

### Fermare l'invio verso un broker

Disattiva **Invio automatico** dall'area admin. Le richieste già create non vengono annullate: ritira quelle in
coda se serve (azione manuale sul database o annullamento per profilo).

### Un utente chiede la cancellazione dell'account

Lo fa da solo in *Impostazioni*. Cancella anche richieste, messaggi, notifiche e report. Se per legge devi
conservare qualcosa, definiscilo nell'informativa: il software cancella tutto.

### Esportazione dati per un utente

*Impostazioni → Esporta i miei dati*, oppure `GET /api/v1/me/export` con il suo token. Non esiste un export lato admin
perché i dati sono cifrati con una chiave che deve restare riservata.

### Rotazione dei segreti

- **`JWT_ACCESS_SECRET`:** cambialo e riavvia: tutti i token di accesso scadono subito, gli utenti rifanno il refresh
  dal cookie senza accorgersene.
- **`CRON_SECRET`, `RESEND_WEBHOOK_SECRET`, `RESEND_API_KEY`:** aggiorna il segreto, poi il job o il webhook.
- **`DATA_ENCRYPTION_KEY`:** **non cambiarla senza una migrazione**. La formattazione `v1:…` dei dati cifrati prevede
  una futura versione; una rotazione richiede di decifrare con la chiave vecchia e ricifrare con la nuova
  (profili, firme, messaggi, posta non abbinata). Il progetto non include ancora lo script: scrivilo e provalo su una
  copia.

### Backup e ripristino

- Attiva i backup continui di MongoDB (Atlas) e prova un ripristino.
- Conserva **fuori dal cloud** una copia della `DATA_ENCRYPTION_KEY`: senza chiave il backup non serve a recuperare i
  dati personali.
- Il registry è anche nel repository: è la sua fonte di verità.

## Risoluzione dei problemi

| Sintomo | Causa probabile | Cosa fare |
|---|---|---|
| L'API non parte: "JWT_ACCESS_SECRET must be at least 32 characters" (o simili) | Configurazione mancante o non valida | Leggi il messaggio: la validazione dice quale variabile correggere |
| `RESEND_API_KEY is required when MAIL_MODE=resend` | Modalità reale senza chiave o senza `INBOUND_DOMAIN` | Imposta le variabili o torna a `dry-run` |
| Nessuna email di verifica | Modalità prova (non si spedisce) o dominio non verificato | In prova usa `LOG_LEVEL=debug` per leggere il link; in reale controlla Resend |
| L'utente non vede il menu admin | L'email non era in `ADMIN_EMAILS` alla registrazione | Aggiungila e fai registrare un nuovo account, oppure imposta `role: "admin"` sul documento utente |
| Le richieste restano `queued` | Scheduler non attivo, profilo in pausa o provider email in errore | Controlla `POST /internal/cron/tick`, lo stato del profilo e i log |
| Solo 5 richieste al giorno vengono inviate per un profilo | Politica Fair-Share attiva (`USER_DAILY_REQUEST_LIMIT=5`) | Comportamento normale e voluto: garantisce che nessun utente monopolizzi la quota Resend (100/giorno, 3000/mese) e protegge la deliverability |
| Quota Resend giornaliera o mensile raggiunta | Tetto di sicurezza raggiunto (95/100 email inviate oggi, o 3000/mese) | I job BullMQ posticipano automaticamente l'invio a domani per non superare il piano e riservare spazio per email di autenticazione |
| Errore di connessione a Redis (BullMQ) | Rete, credenziali o timeout verso l'istanza Redis Cloud | Verifica `REDIS_URL` e `REDIS_HOST`/`REDIS_PORT`. In assenza di Redis l'app opera in modalità fallback diretta |
| Una richiesta è passata a `action_required` con "Invio automatico non riuscito" | 5 tentativi falliti o errore permanente | Guarda l'errore nella cronologia; l'utente può inviarla a mano; correggi il recapito nel registry |
| Le risposte dei broker non compaiono | Webhook o dominio di ricezione non configurati, segreto sbagliato | Verifica in Resend le consegne del webhook (`400` = firma non valida) |
| Un utente dice che le richieste non partono e ha configurato la sua casella | Credenziali SMTP scadute o rifiutate: il profilo ha un `senderError` e le richieste attendono | L'utente riceve una notifica e deve salvare di nuovo le impostazioni di invio (o tornare a Cancellamy); l'invio riprende subito |
| Un utente con Gmail collegato dice che le richieste non partono | Ha revocato l'accesso dal suo account Google o l'autorizzazione è scaduta: `senderError` "Google access was revoked or expired" | L'utente riceve una notifica e deve premere di nuovo *Collega con Google*; l'invio riprende subito |
| `SMTP_HOST_NOT_ALLOWED` quando l'utente salva il server | Host privato o porta diversa da 25/465/587/2525 | È la protezione SSRF: serve un server SMTP pubblico (in sviluppo `SMTP_ALLOW_PRIVATE_HOSTS=true`) |
| La scheda *Violazioni dei dati* non compare | `HAVEIBEENPWNED_API_KEY` assente o `breach` in `FEATURES_DISABLED` | Configura la chiave; le email vanno prima verificate nella scheda Identità |
| Il controllo violazioni resta `pending` o `error` | Limite di frequenza o chiave rifiutata | `pending` con attesa = Retry-After del servizio; `error` = riprova dopo un'ora; controlla la chiave |
| Nessun SMS di verifica | `SMS_PROVIDER=none` o credenziali Twilio errate | Con `dry-run` il codice è nel log a livello `debug`; con `twilio` guarda l'errore `503` e il pannello del fornitore |
| Il dossier risponde 502 `TIMESTAMP_UNAVAILABLE` | L'autorità `TSA_URL` non risponde o rifiuta | L'utente può scaricare il dossier senza marca temporale; verifica l'indirizzo dell'autorità |
| La classifica è vuota | Pochi utenti distinti per broker (soglia `LEADERBOARD_MIN_USERS`) o solo richieste in modalità prova | Normale all'inizio: abbassa la soglia solo su istanze private |
| Gli allegati dei broker non si scaricano più | Sono scaduti (`ATTACHMENT_RETENTION_DAYS`) | Comportamento voluto: sono cancellati per minimizzazione |
| Una risposta è finita in "Posta non abbinata" | Non contiene il riferimento `CNC-`, mittente diverso dal dominio atteso, oppure DMARC fallito | Assegnala a mano dall'area admin |
| Il frontend chiede continuamente di accedere | Cookie non same-site (frontend e API su domini diversi) | Servi l'API dallo stesso dominio (proxy `/api`) |
| Errori 429 | Limite di frequenza | Aumenta `THROTTLE_LIMIT`/`AUTH_THROTTLE_LIMIT` o controlla un abuso |
| `/health/ready` risponde 503 | MongoDB non raggiungibile | Verifica rete, credenziali, allowlist di Atlas |
| L'avvio dice "registry seed failed" | File del registry non valido (id duplicati, campi mancanti) | Correggi il file: l'API resta in funzione con i dati già presenti |
| In locale la porta è occupata | Un altro processo usa 3000 o 5173 | Cambia `PORT` e `VITE_PROXY_TARGET` |

## Retention automatica

Sono cancellati in automatico da MongoDB (indici TTL): codici di verifica (dopo la scadenza), consegne del webhook
(30 giorni), sessioni scadute e allegati ricevuti (`ATTACHMENT_RETENTION_DAYS`). Richieste, messaggi, report, notifiche e
pratiche restano finché l'utente non elimina profilo o account: la politica di conservazione va definita dall'operatore.

## Log

Ogni richiesta HTTP genera una riga JSON con `severity`, metodo, URL (senza query string), codice di stato e tempo di
risposta. Le intestazioni sensibili sono oscurate. Livelli: `error`, `warn`, `info` (predefinito), `debug`.

## Limiti noti da tenere presenti

- Nessuna cancellazione automatica per conservazione: va definita dall'operatore.
- Nessuna rotazione automatica della chiave di cifratura.
- La classificazione delle risposte è euristica e può sbagliare: l'utente può correggere l'esito.
- L'identità dell'iscritto non è verificata oltre all'email.
