# 12 · Funzionalità avanzate

Oltre al cuore del servizio (richieste di cancellazione, solleciti, reclamo), Cancellamy offre sette funzioni
aggiuntive. Per ciascuna trovi: a cosa serve, come si usa, come la configura chi gestisce l'istanza, i limiti e le
scelte di privacy.

| # | Funzione | Dove si trova | Si attiva con |
|---|---|---|---|
| 1 | [Invio dalla propria casella](#1--invio-dalla-propria-casella-smtp) (SMTP, con preset Gmail, oppure [Collega con Google](#collegare-gmail-con-google-oauth)) | Profilo → *Mittente delle email* | SMTP sempre disponibile (`FEATURES_DISABLED=sender` per spegnerla); *Collega con Google* richiede `GOOGLE_OAUTH_CLIENT_ID` e `GOOGLE_OAUTH_CLIENT_SECRET` |
| 2 | [Dossier probatorio](#2--dossier-probatorio) | Dettaglio richiesta → *Scarica il dossier* | Sempre; la marca temporale richiede `TSA_URL` |
| 3 | [Verifica dei contatti e "Cosa sai di me"](#3--verifica-dei-contatti-e-cosa-sai-di-me-art-15) | Profilo → *Identità*; menu *Cosa sai di me* | Sempre; SMS opzionali con `SMS_PROVIDER` |
| 4 | [Controllo violazioni dei dati](#4--controllo-violazioni-dei-dati-have-i-been-pwned) | Profilo → *Violazioni dei dati* | `HAVEIBEENPWNED_API_KEY` |
| 5 | [Deindicizzazione](#5--deindicizzazione-da-google-e-bing) | Menu *Deindicizzazione* | Sempre |
| 6 | [Classifica pubblica dei broker](#6--classifica-pubblica-dei-broker) | Pagina pubblica *Classifica* | Sempre |
| 7 | [Difesa dal telemarketing](#7--difesa-dal-telemarketing) | Menu *Telemarketing* | Sempre |

L'applicazione chiede `GET /config` all'avvio e **nasconde automaticamente** ogni schermata la cui funzione è spenta o
non configurata: chi fa self-hosting accende solo ciò che gli serve. Per spegnere una funzione imposta
`FEATURES_DISABLED` con un elenco separato da virgole tra `sender`, `dossier`, `access`, `delisting`, `leaderboard`,
`nuisance`, `breach`.

---

## 1 · Invio dalla propria casella (SMTP)

**A cosa serve.** Molti broker controllano che la richiesta arrivi dall'indirizzo con cui sei registrato. Se le email
partono dalla tua casella (il tuo indirizzo come mittente) hanno più probabilità di essere accolte.

**Come si usa.** Nella pagina del profilo, scheda *Mittente delle email*. Scegli il provider (*Gmail*, *iCloud Mail*,
*Yahoo Mail*, *Libero Mail*, *Aruba*): server, porta, cifratura e nome utente si compilano da soli e la scheda spiega come
ottenere la password per le app. Per gli altri provider inserisci server SMTP, porta, utente e **password per le app** (quella dedicata, non la password principale), scegli quale indirizzo del profilo usare come
mittente e premi **Prova la connessione**, poi **Salva**. Per tornare a Cancellamy usa **Torna a Cancellamy**.

**Cosa cambia.**
- **From** = il tuo indirizzo; **Reply-To** = l'indirizzo di Cancellamy del profilo (`r-…@dominio-di-ricezione`), così le
  risposte dei broker tornano a noi e restano tracciate. L'indirizzo è mostrato nella scheda per trasparenza.
- Vale per richieste, solleciti e documento d'identità. Ogni messaggio mostra *come* è partito (`via`: Cancellamy, tua
  casella, prova, ricevuta).
- Se la tua casella rifiuta le credenziali (password scaduta o revocata) **le richieste di quel profilo restano in
  attesa**: non cambiamo mittente di nascosto. Ricevi una notifica (una sola) e, dopo aver salvato di nuovo le
  impostazioni, l'invio riprende subito.
- In modalità prova non ci si collega mai al tuo server di posta.

**Sicurezza.**
- Le impostazioni, password compresa, sono **cifrate** (AES-256-GCM) e la password non viene mai restituita dall'API né
  tenuta dal browser dopo l'invio.
- Protezione **SSRF**: il server SMTP deve essere pubblico. Sono rifiutati indirizzi privati, loopback, link-local,
  metadata cloud e porte diverse da 25, 465, 587 e 2525; l'host viene risolto una volta sola e la connessione avviene
  sull'IP controllato (nessun DNS rebinding). STARTTLS è sempre richiesto salvo TLS implicito.
- L'indirizzo mittente deve essere uno di quelli del profilo.
- Solo per sviluppo e test: `SMTP_ALLOW_PRIVATE_HOSTS=true` toglie i limiti su host e porte.

**Limite noto.** Il protocollo SMTP non offre una chiave di idempotenza come l'API di Resend: se il processo si
interrompe dopo l'invio ma prima di salvarlo, un nuovo tentativo potrebbe duplicare un'email (caso raro).

**API.** `GET/PUT/DELETE /profiles/:id/sender`, `POST /profiles/:id/sender/test`.

### Collegare Gmail con Google (OAuth)

**A cosa serve.** Con un account Google non serve creare né incollare nessuna password: nella scheda *Mittente delle email*
si preme **Collega con Google**, si autorizza e le richieste partono dal proprio Gmail (compaiono anche nella cartella
*Posta inviata*). Il permesso richiesto è solo quello di **inviare** email (`gmail.send`): Cancellamy non legge la casella.

**Come funziona.** L'app chiede l'indirizzo di consenso a `POST /profiles/:id/sender/gmail/start` e manda il browser a Google;
Google torna a `<APP_URL>/app/collega-google?code=…&state=…` e l'app completa il collegamento con
`POST /sender/gmail/complete`.
- Il flusso usa PKCE. Lo `state` è cifrato (AES-256-GCM), legato all'utente e al profilo e vale 10 minuti: nessuna sessione sul server.
- L'indirizzo Google deve essere uno di quelli del profilo, altrimenti il collegamento è rifiutato e il permesso revocato.
- Il token di aggiornamento è **cifrato** con `DATA_ENCRYPTION_KEY` e non viene mai restituito dall'API.
- Come per SMTP, **From** = indirizzo Gmail dell'utente e **Reply-To** = indirizzo di Cancellamy del profilo.
- Se Google revoca l'accesso (l'utente lo toglie dal proprio account) le richieste del profilo restano in attesa, l'utente riceve
  una sola notifica e basta ricollegare per far ripartire l'invio.
- *Scollega*, l'eliminazione del profilo e quella dell'account revocano il permesso anche presso Google.
- In modalità prova non viene contattato nessun server Google per inviare.

**Come la configura chi gestisce l'istanza.**
1. In Google Cloud Console crea un progetto e abilita la **Gmail API**.
2. *Schermata di consenso OAuth*: tipo *Esterno*, nome dell'app, email di supporto, link a informativa privacy e termini;
   aggiungi gli ambiti `openid`, `email` e `https://www.googleapis.com/auth/gmail.send`.
3. *Credenziali* → *ID client OAuth* di tipo **Applicazione web**, con URI di reindirizzamento autorizzato
   `<APP_URL>/app/collega-google` (o il valore di `GOOGLE_OAUTH_REDIRECT_URI`).
4. Imposta `GOOGLE_OAUTH_CLIENT_ID` e `GOOGLE_OAUTH_CLIENT_SECRET` (il segreto da Secret Manager). Con entrambe vuote la
   funzione è spenta e la scheda non la mostra; impostarne una sola è un errore di configurazione.

**Limiti noti.**
- Finché l'app Google è in stato *Testing* funziona solo per gli utenti di prova che aggiungi a mano (massimo 100) e Google fa
  scadere il token di aggiornamento dopo 7 giorni: l'utente deve ricollegare. Per aprirla al pubblico bisogna **pubblicare l'app**:
  `gmail.send` è un ambito sensibile e richiede la verifica di Google (descrizione dell'uso, informativa privacy, dominio verificato).
- Gmail applica i propri limiti giornalieri di invio: se li raggiunge le richieste restano in coda e ripartono più tardi.
- Gli allegati di un'email (delega, documento d'identità) sono limitati dalle dimensioni massime di Gmail.

---

## 2 · Dossier probatorio

**A cosa serve.** Per un reclamo al Garante (o un legale) serve poter dimostrare cosa è stato chiesto, quando e cosa è
stato risposto. Il dossier raccoglie tutto in un archivio con impronte che provano che i file non sono cambiati.

**Come si usa.** Dal dettaglio di una richiesta: **Scarica il dossier probatorio** (se la marca temporale è
disponibile compare la casella *Aggiungi marca temporale*).

**Contenuto dello ZIP.**
- `00-copertina.pdf`: riepilogo e cronologia;
- `01-delega.pdf`: la delega firmata (anche se poi revocata);
- `messaggi/NNN-inviato|ricevuto-DATA.txt` e `messaggi/messaggi.json`: ogni email con data UTC, mittente,
  destinatari, oggetto, metodo di invio, allegati (solo metadati) e classificazione;
- `cronologia.json`: gli eventi della pratica;
- `manifest.json`: elenco di tutti i file con **SHA-256** e dimensione; `manifest.sha256`: impronta del manifest;
- `manifest.tsr` (facoltativo): **marca temporale RFC 3161** dell'impronta del manifest;
- `LEGGIMI.txt`: istruzioni di verifica.

**Verifica.** `shasum -a 256 -c manifest.sha256` controlla il manifest; per ogni file confronta l'impronta con
quella elencata. Con la marca temporale:
`openssl ts -verify -data manifest.json -in manifest.tsr -CAfile <ca.pem> -untrusted <tsa.crt>`.

**Marca temporale.** Imposta `TSA_URL` con l'indirizzo di una autorità di marcatura RFC 3161 (ad esempio
`https://freetsa.org/tsr`, gratuita; per valore legale più forte serve un'autorità qualificata eIDAS a pagamento).
**All'autorità viaggia solo l'impronta** del manifest, mai dati personali. Se l'autorità non risponde l'API risponde
`502` con codice `TIMESTAMP_UNAVAILABLE`. Verificato dal vivo con FreeTSA: stato "Granted" e impronta coincidente.

**Cosa il dossier non è.** Un documento tecnico: dimostra l'integrità dei file, non la veridicità del contenuto, e il
suo valore probatorio va valutato da un professionista.

**API.** `GET /requests/:id/dossier.zip?timestamp=true|false`.

---

## 3 · Verifica dei contatti e "Cosa sai di me" (art. 15)

### Verifica dei contatti

**A cosa serve.** Dimostra che chi si è iscritto controlla gli indirizzi del profilo. È il requisito per le funzioni
che restituiscono dati (richieste di accesso) o li cercano (violazioni), perché **nessuno possa farsi consegnare i dati di
un'altra persona**.

**Come si usa.** Profilo → scheda *Identità*: per ogni email o telefono premi **Verifica**, inserisci il codice di 6
cifre ricevuto e conferma.

**Regole.** Codice valido 15 minuti, 5 tentativi, una richiesta al minuto e al massimo 5 all'ora per contatto. Una
volta verificato, il contatto resta verificato finché non lo cambi (la verifica è legata al valore, conservato solo
come impronta con chiave). Il profilo è **verificato** quando tutte le email lo sono e, se l'istanza ha un fornitore
SMS e `IDENTITY_REQUIRE_PHONE` è attivo, anche tutti i telefoni inseriti.

**Limite onesto.** Dimostra il possesso dei contatti, **non** che il nome sia davvero quello dell'iscritto: alza il
costo di un abuso, non lo azzera. Per un livello più alto servirebbe SPID/CIE o la verifica di un documento.

**Configurazione.** Gli SMS richiedono `SMS_PROVIDER` = `twilio` (con `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_FROM`) oppure `dry-run` (solo log, per provare). Senza provider i telefoni non sono verificabili e non sono
richiesti.

### Cosa sai di me

**A cosa serve.** Chiede ai broker quali dati hanno su di te (art. 15 GDPR): conferma del trattamento, copia dei dati,
finalità, destinatari, origine, conservazione. Serve a capire dove sei presente e a decidere dove insistere.

**Come si usa.** Menu *Cosa sai di me*: scegli fino a 20 broker contattabili (serve profilo attivo e identità
verificata), invia. Quando un broker risponde:
1. apri la richiesta, leggi il messaggio e scarica gli **allegati** (il file con i tuoi dati);
2. registra l'**esito**: dati presenti o no e le categorie trovate (identificativi, contatti, indirizzi, professionali,
   finanziari, attività online, posizione, dati demografici, altro) con una nota;
3. la **mappa dati** aggrega tutto: quanti broker hanno risposto, in quanti compari, quali categorie.

**Dettagli.**
- Sono richieste normali con `kind: 'access'`: stessi stati, solleciti e scadenza di 30 giorni, ma **non si rinnovano** e
  non contano nei numeri della panoramica (che misura le rimozioni).
- Una risposta "non trattiamo dati su di te" chiude la richiesta e registra in automatico "nessun dato" (correggibile).
- I testi di accesso (italiano/inglese) citano l'art. 15, par. 1 e 3, e l'art. 22 sulla profilazione.
- Per i registri di opposizione, il Garante e i motori di ricerca la richiesta di accesso non ha senso e viene saltata.
- **Allegati ricevuti:** conservati **cifrati** per `ATTACHMENT_RETENTION_DAYS` (30 di default) e poi cancellati,
  massimo `MAX_ATTACHMENT_BYTES` (10 MB) l'uno e 5 per email. Sono serviti solo come download (mai interpretati dal
  browser); i tipi non sicuri diventano `application/octet-stream`.

**API.** `GET /profiles/:id/identity`, `POST …/identity/send-code`, `POST …/identity/confirm`,
`POST /requests/access`, `PUT /requests/:id/findings`, `GET /profiles/:id/data-map`,
`GET /requests/:id/messages/:mid/attachments/:aid`.

---

## 4 · Controllo violazioni dei dati (Have I Been Pwned)

**A cosa serve.** Ti dice se le tue email compaiono in violazioni di dati note (data breach) e ti avvisa quando ne
emergono di nuove, così sai quali password cambiare.

**Come si usa.** Profilo → scheda *Violazioni dei dati*: per ogni **email verificata** vedi le violazioni (nome, data,
tipi di dati esposti, se verificata o sensibile). *Controlla ora* ripete il controllo (al massimo una volta all'ora).

**Come funziona.**
- Si controllano **solo le email di cui hai dimostrato il possesso**: interrogare un'email altrui sarebbe una fuga di
  informazioni.
- Il controllo parte appena un'email è verificata; poi si ripete ogni `BREACH_RECHECK_DAYS` (30). Lo scheduler procede
  piano (`HIBP_REQUEST_INTERVAL_MS`, 6,5 s tra una chiamata e l'altra) per rispettare il limite del servizio; in caso di
  limite superato (429) aspetta il tempo indicato, in caso di chiave rifiutata riprova dopo un'ora.
- Notifiche: la prima volta "compare in N violazioni"; poi "Nuova violazione di dati: …".
- Le email controllate sono conservate **cifrate**.
- **Attribuzione obbligatoria:** l'interfaccia mostra sempre "Dati forniti da Have I Been Pwned" con il link.

**Configurazione.** Serve una chiave API di Have I Been Pwned (a pagamento): `HAVEIBEENPWNED_API_KEY`, più
`HIBP_USER_AGENT`. Senza chiave la funzione **non compare**. Ogni istanza self-hosted porta la propria chiave.

**API.** `GET /profiles/:id/breaches`, `POST /profiles/:id/breaches/check` (`202`).

---

## 5 · Deindicizzazione da Google e Bing

**A cosa serve.** Un risultato di ricerca su di te può essere rimosso dal motore (diritto all'oblio, art. 17 e sentenza
C-131/12) anche se la pagina resta online. Cancellamy ti guida e tiene traccia della pratica.

**Come si usa.** Menu *Deindicizzazione* → *Nuova richiesta*: scegli il profilo e il motore, incolla l'URL, indica la ricerca
(di solito il tuo nome), il motivo (obsoleta, non pertinente, inesatta, eccessiva, nessun interesse pubblico, altro) e
una spiegazione. La **guida** mostra i passaggi, il link al **modulo ufficiale** (Google:
`reportcontent.google.com/forms/rtbf`; Bing: `bing.com/webmaster/tools/eu-privacy-request`, entrambi verificati sulle
pagine ufficiali) e un **testo già pronto** da incollare con i tuoi dati. Dopo l'invio premi *L'ho inviata*.

**Stati.** `Da inviare → Inviata → Accolta | Accolta in parte | Respinta`; da *Respinta* o *Accolta in parte* si può
passare a *In ricorso*. *Annullata* è possibile finché non è conclusa. Dopo 30 giorni dall'invio arriva una notifica per
controllare l'esito (una sola per invio).

**Consigli inclusi nella guida.** Il motore valuta l'interesse pubblico; la rimozione vale per le ricerche con il tuo
nome (per togliere la pagina alla fonte scrivi al sito); non c'è un termine garantito; in caso di rifiuto restano il
Garante e il tribunale.

**Limiti.** Il modulo si compila a mano: Cancellamy non invia nulla al posto tuo. Massimo 100 pratiche per utente. Il
documento d'identità, se richiesto, lo carichi nel modulo del motore: Cancellamy non lo vede.

**API.** `GET/POST /delistings`, `GET/PATCH/DELETE /delistings/:id`, `GET /delistings/:id/guide`.

---

## 6 · Classifica pubblica dei broker

**A cosa serve.** Mostra a tutti chi risponde davvero alle richieste: quanti rispondono, in quanto tempo, quanti
rifiutano. Orienta il registry e mette pressione sui soggetti che ignorano la legge.

**Come si usa.** Pagina pubblica *Classifica*: ordina per tasso di risposta, richieste completate, rifiuti, giorni alla
prima risposta o numero di utenti; filtra per categoria.

**Come si calcola.**
- Si misurano le richieste di cancellazione **inviate davvero** (le simulazioni in modalità prova non contano mai) e
  abbastanza vecchie per aver avuto una possibilità di risposta (30 giorni) oppure già risolte.
- *Risposta* = il broker ha scritto qualcosa di più di una ricevuta automatica.
- Tasso di risposta, completamento, rifiuto e "scaduta senza risposta" sono percentuali sulle richieste misurate; i
  tempi sono mediane in giorni.

**Privacy.** Solo **dati aggregati e anonimi**. Un broker compare soltanto se almeno `LEADERBOARD_MIN_USERS` (20) utenti
diversi sono nel campione: sotto la soglia i numeri potrebbero far risalire a una persona, quindi il broker è nascosto
(il totale dei nascosti è indicato). Il risultato è in cache per 10 minuti.

**API.** `GET /brokers/leaderboard?sort=&order=&category=` (pubblica).

---

## 7 · Difesa dal telemarketing

**A cosa serve.** Il Registro Pubblico delle Opposizioni blocca le telefonate commerciali, ma servono prove quando
continuano. Questa sezione annota i contatti indesiderati e prepara la segnalazione al Garante.

**Come si usa.** Menu *Telemarketing*:
1. **Iscriviti al RPO** dalle richieste manuali del profilo (la scheda *Registro Pubblico delle Opposizioni* ti
   rimanda lì). Quindici giorni dopo l'iscrizione ricevi una notifica: da quel momento le chiamate commerciali senza
   consenso non sono più lecite.
2. **Annota ogni contatto indesiderato**: canale (telefonata, SMS, messaggio, email, posta), numero o mittente,
   società dichiarata, data e ora, cosa ti hanno proposto, se hai mai dato il consenso.
3. Ogni annotazione indica se l'iscrizione al RPO era **già efficace** in quel momento.
4. La tabella dei **chiamanti più frequenti** raggruppa lo stesso numero scritto in modi diversi (`+39 02…`, `0039 02…`,
   `02…`).
5. **Prepara la segnalazione al Garante**: testo (art. 144 e art. 130 del Codice privacy, D.P.R. 178/2010), PDF e
   istruzioni (portale o PEC `protocollo@pec.gpdp.it`, che accetta solo mittenti PEC). Puoi includere tutte le
   annotazioni o solo alcune.

**Privacy.** Numeri, società e descrizioni (informazioni su terzi) sono **cifrati**; non esiste nessun elenco pubblico
dei numeri segnalati, per evitare diffamazioni ed errori. Massimo 500 annotazioni per utente.

**API.** `GET /nuisance?profileId=`, `POST /nuisance`, `DELETE /nuisance/:id`, `POST /nuisance/complaint`,
`GET /nuisance/complaint.pdf?profileId=`.

---

## Modello d'uso: istanza pubblica e self-hosting

Il progetto è pensato così: **una istanza pubblica ospitata dal maintainer**, e codice open source (AGPL-3.0) che
chiunque può studiare, modificare e ospitare a sua volta.

- Le funzioni dipendenti da servizi esterni (SMS, violazioni, marca temporale) sono **opzionali** e si spengono da sole
  senza chiave: nessuno è obbligato ad avere un contratto con terzi.
- Con `FEATURES_DISABLED` ogni operatore decide cosa offrire.
- La cartella `selfhost/` del backend contiene uno stack completo (MongoDB, API, web) avviabile con
  `docker compose up -d --build`: vedi [Deploy → Self-hosting](./06-deploy.md#self-hosting-con-docker-compose).
- La licenza AGPL impone a chi offre una versione modificata come servizio di mettere a disposizione degli utenti il
  proprio codice sorgente: il link nel piè di pagina si imposta con `VITE_SOURCE_URL` / `SOURCE_URL`.
