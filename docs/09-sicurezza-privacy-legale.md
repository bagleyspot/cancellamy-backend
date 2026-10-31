# 9 · Sicurezza, privacy e aspetti legali

> Questo capitolo descrive le scelte tecniche del progetto e i punti da affrontare con un professionista **prima di
> offrire il servizio a terzi**. Non è consulenza legale.

## Quali dati tratta Cancellamy

| Dato | Perché | Come è protetto |
|---|---|---|
| Email e password dell'account | Accesso | Password con argon2id (mai in chiaro); email in chiaro (serve per il login) |
| Dati del profilo (nome, data di nascita, codice fiscale, email, telefoni, indirizzi, varianti del nome) | Identificarti presso i broker | Cifrati con AES-256-GCM nel database |
| Firma della delega | Prova dell'incarico | Cifrata; si conservano anche data, versione e impronta del testo e un hash dell'IP |
| Messaggi (richieste e risposte dei broker) | Cronologia e prova | Oggetto e testo cifrati; degli allegati **in uscita** (e del documento d'identità) restano solo i metadati |
| Allegati **ricevuti** dai broker (ad esempio la copia dei tuoi dati) | Permettere di leggerli | Cifrati; cancellati dopo `ATTACHMENT_RETENTION_DAYS` (30); serviti solo come download |
| Impostazioni SMTP (se usi la tua casella) | Inviare dalla tua email | Cifrate, password compresa; mai restituita; cancellate se torni a Cancellamy o elimini il profilo |
| Verifica dei contatti | Provare che gli indirizzi sono tuoi | Solo impronte con chiave (HMAC) dei contatti verificati e dei codici; i codici scadono in 15 minuti |
| Email controllate per le violazioni | Avvisarti dei data breach | Cifrate; solo email di cui hai dimostrato il possesso |
| Contatti indesiderati (numero, società, descrizione) | Preparare la segnalazione | Cifrati: sono informazioni su terzi; nessun elenco pubblico |
| Pratiche di deindicizzazione | Tenere traccia | URL e motivazioni dell'utente; nessun documento |
| Documenti d'identità | Solo se un broker li chiede | **Non vengono mai salvati**: inoltrati per email e scartati |
| Stato e date delle richieste, notifiche, report | Funzionamento | Non contengono dati personali oltre al nome del broker |

Dati **non** raccolti: nessun tracciamento e nessun analytics; il frontend non carica script, font o immagini da terzi.

Servizi esterni usati a runtime (tutti tranne il primo sono **opzionali** e spenti se non configurati):

| Servizio | Per cosa | Cosa riceve |
|---|---|---|
| Fornitore email (Resend) | Invio e ricezione delle richieste | Email e allegati (la delega) destinati ai broker |
| Have I Been Pwned | Controllo delle violazioni | Le email verificate dell'utente |
| Fornitore SMS (Twilio) | Codici di verifica dei telefoni | Numero di telefono e testo del codice |
| Autorità di marcatura temporale | Marca del dossier | Solo l'impronta SHA-256 del manifest |
| Server SMTP dell'utente | Invio dalla propria casella | Le email da inviare, con le credenziali dell'utente |

Ognuno di questi soggetti è un **responsabile o destinatario** da indicare nell'informativa e da regolare con un
contratto quando offri il servizio a terzi.

## Minimizzazione

- Nelle email ai broker compaiono **solo** i campi che l'utente ha inserito.
- Ai broker si chiede di non richiedere il documento d'identità se i dati forniti bastano.
- Le richieste personalizzate e il reclamo usano gli stessi dati, nient'altro.

## Misure di sicurezza

| Area | Misura |
|---|---|
| Password | argon2id; minimo 10 caratteri; blocco di 15 minuti dopo 10 errori; messaggi generici |
| Sessioni | Accesso di 15 minuti in memoria; refresh in cookie `HttpOnly`, ruotato, con rilevamento del riuso; revoca di tutte le sessioni al reset password |
| Autorizzazione | Ogni query è filtrata per utente; risorse altrui rispondono 404; ruolo admin verificato a ogni richiesta |
| Cifratura | AES-256-GCM a livello di campo, IV casuale; chiave da `DATA_ENCRYPTION_KEY` |
| Trasporto | HTTPS (cookie `Secure` in produzione), `Strict-Transport-Security`, intestazioni di `helmet`, CSP restrittiva nel container frontend |
| Frequenza | Limiti per IP generali e più stretti sull'autenticazione |
| Input | Validazione rigorosa con whitelist (campi extra rifiutati), tipi e dimensioni dei file controllati (max 5 MB, PDF/JPG/PNG), identificativi validati |
| Webhook | Firma verificata, tolleranza 5 minuti, deduplicazione; DMARC fallito → posta non abbinata |
| SMTP dell'utente | Protezione **SSRF** (niente host privati, risoluzione unica e connessione all'IP verificato, solo porte 25/465/587/2525), STARTTLS richiesto, credenziali cifrate, nessun invio in modalità prova |
| Verifica dei contatti | Codici a 6 cifre con scadenza, 5 tentativi, una richiesta al minuto e 5 all'ora, confronto a tempo costante |
| Allegati ricevuti | Dimensione e numero limitati, cifrati, scadenza automatica, tipo MIME ridotto a un elenco sicuro (mai HTML) e `Content-Disposition: attachment` |
| Marca temporale | All'autorità arriva solo l'impronta SHA-256 del manifest |
| Classifica pubblica | Soglia minima di utenti distinti, solo aggregati, simulazioni escluse, cache di 10 minuti |
| Endpoint interni | `/internal/cron/tick` richiede un segreto confrontato a tempo costante, 404 se non configurato |
| Log | JSON strutturato; intestazioni `authorization` e `cookie` oscurate; i dati del profilo e il contenuto dei messaggi non vengono scritti nei log; in modalità prova compare l'indirizzo del destinatario (in modalità prova, a livello `debug`, si scrivono oggetto e corpo delle email: **non usare `debug` in produzione**) |
| Container | Utente non root, immagine minimale, nessun segreto nell'immagine |
| Dipendenze | Lockfile; gli avvisi di `npm audit` noti riguardano solo dipendenze di sviluppo (Jest) |

## I tuoi diritti (utenti)

- **Accesso e portabilità (art. 15 e 20):** *Impostazioni → Esporta i miei dati* produce un JSON con tutto, in chiaro.
- **Cancellazione (art. 17):** *Impostazioni → Elimina account* cancella account, profili, delega, richieste,
  messaggi, notifiche e report. Rimangono, fuori dal nostro controllo, le richieste già inviate ai broker.
- **Revoca della delega:** in qualsiasi momento, dal profilo.
- **Rettifica:** modifica dei dati dal profilo.

## Chi è titolare del trattamento

Dipende da chi gestisce l'istanza:

- **Usi un'istanza ospitata da qualcuno:** l'**operatore** (`OPERATOR_NAME`) è titolare dei dati che inserisci e ne
  risponde. Deve fornirti informativa privacy e termini.
- **Ospiti l'istanza per te o per i tuoi familiari:** sei tu il titolare del tuo trattamento (uso personale).
- **Ospiti l'istanza per terzi** (comunità, associazione, azienda): diventi **titolare** (o responsabile, se agisci per
  conto di un'organizzazione) e valgono tutti gli obblighi del GDPR.

Il progetto software non raccoglie dati: li raccoglie chi lo esegue.

## Se offri il servizio a terzi: da fare prima

- [ ] **Informativa privacy e termini di servizio** rivisti da un legale. Le pagine incluse sono **bozze complete** (non più segnaposto): il
      titolare e i contatti vengono da `OPERATOR_NAME`, `OPERATOR_ADDRESS` e `SUPPORT_EMAIL`, ma vanno comunque verificate da un
      professionista prima di offrire il servizio a terzi. Lo stesso vale per il testo della delega (`templates/authorization-text.ts`, versione `2026-10-v2`).
- [ ] **Registro dei trattamenti** (art. 30) e, se necessario, nomina di un **DPO**.
- [ ] **DPIA** (valutazione d'impatto, art. 35): trattamento su scala di dati personali di molti interessati,
      conservazione di firme e comunicazioni, uso di un fornitore terzo. Punti da coprire: finalità, necessità,
      rischi (accesso non autorizzato, furto d'identità tramite iscrizione con dati altrui, perdita della chiave),
      misure (questa pagina).
- [ ] **Contratti con i responsabili:** Resend, il fornitore cloud, MongoDB Atlas (DPA e trasferimenti extra-UE;
      scegli regioni UE).
- [ ] **Procedura di data breach** (art. 33-34): notifica al Garante entro 72 ore.
- [ ] **Conservazione:** decidi per quanto tempo tenere richieste e messaggi dopo l'ultima attività
      (il progetto non cancella in automatico: va definito e automatizzato dall'operatore).
- [ ] **Prova dell'identità dell'utente:** il servizio verifica l'email e richiede che la firma coincida col nome, ma
      non verifica che il nome sia davvero quello dell'iscritto. Vedi i rischi qui sotto.
- [ ] **Termini d'uso contro gli abusi** (iscrizione con dati altrui, richieste a soggetti non pertinenti).

## Rischi noti e come sono gestiti

| Rischio | Gestione attuale | Residuo |
|---|---|---|
| Qualcuno si iscrive con **dati di un'altra persona** per far cancellare dati altrui o ottenerne l'accesso | Email verificata; firma uguale al nome; le **richieste di accesso (art. 15) richiedono la verifica del possesso di tutti i contatti del profilo** con un codice; le risposte tornano a un indirizzo legato al profilo | L'identità non è verificata: un abuso resta possibile. Considera verifiche aggiuntive su istanze pubbliche |
| **Spam** verso indirizzi arbitrari tramite richieste personalizzate | Limite mensile per utente; testo che identifica l'utente; solo profili attivi | Moderazione e rate limit a monte |
| **Furto della chiave** di cifratura | Chiave solo in Secret Manager | Chi ha DB e chiave legge tutto: separa i privilegi |
| **Perdita della chiave** | – | Dati personali irrecuperabili: backup della chiave obbligatorio |
| Il broker **rifiuta legittimamente** | Voce di registry con ostacoli; categorie escluse dall'invio automatico | Il servizio non può garantire la cancellazione |
| **Risposta falsa** ("cancellato") che chiude la richiesta | DMARC fallito non viene applicato; classificazione correggibile dall'utente; verifica periodica a 90 giorni | Una risposta ben contraffatta potrebbe passare |
| **Invio a indirizzo sbagliato** | Si scrive solo a recapiti `verified`; admin può disabilitare una voce | Errori nel registry possibili |

## Basi giuridiche delle richieste

Le richieste citano:

- **art. 17 GDPR** (cancellazione) quando i dati sono trattati senza una base che lo impedisca o l'interessato revoca il
  consenso;
- **art. 21 GDPR** (opposizione), efficace in particolare per marketing diretto e per i dati di ditte individuali e
  professionisti;
- **art. 19** (comunicazione ai destinatari) e **art. 12.3** (risposta entro un mese);
- **art. 77** (reclamo al Garante) e artt. 140-bis e seguenti del Codice privacy come via di tutela.

Alcuni soggetti possono rifiutare legittimamente: **centrali rischi** (CRIF, Experian, CTC: solo dati inesatti o
illeciti), **banche dati antiriciclaggio/PEP** (interesse legittimo e obblighi di legge), **registri pubblici** e dati
del **registro imprese** (obbligo di legge). Per i dati degli **elenchi telefonici** la cancellazione efficace passa
dall'**operatore telefonico** che alimenta il DBU.

## Segnalare una vulnerabilità

Vedi `SECURITY.md` nel repository: segnala in privato ai maintainer; l'obiettivo è rispondere entro 5 giorni
lavorativi.
