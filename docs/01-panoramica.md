# 1 · Panoramica

## Il problema

I tuoi dati personali (nome, email, telefono, indirizzo) finiscono in banche dati commerciali che li usano per
marketing, profilazione e vendita: elenchi telefonici, aggregatori di dati camerali, strumenti di "sales
intelligence", app che identificano chi chiama, archivi di notizie. Il GDPR ti dà il diritto di chiedere la
cancellazione (art. 17) e di opporti al trattamento (art. 21), ma farlo a mano verso decine di soggetti è lungo:
bisogna trovare il recapito giusto, scrivere la richiesta, ricordarsi le scadenze, sollecitare, riprovare.

## La soluzione

Cancellamy lo fa per te. Tu inserisci i dati con cui sei presente online e firmi una **delega**; il servizio:

1. invia una richiesta di cancellazione e opposizione a ogni soggetto del [registry](./04-registry.md) per cui il
   recapito è stato verificato;
2. ti guida passo passo dove serve un'azione manuale (modulo web, telefono, PEC, Registro delle Opposizioni);
3. legge le risposte e aggiorna lo stato di ogni richiesta;
4. dopo 30 giorni senza risposta sollecita (due volte) e ti prepara una **bozza di reclamo al Garante**;
5. ripete la richiesta ogni 90 giorni dopo una cancellazione, perché i dati possono essere raccolti di nuovo.

Tutto è visibile in un'area personale con avanzamento, cronologia, messaggi e notifiche.

## Per chi è

- Persone residenti in Italia (anche famiglie: un account può avere più profili).
- Chi gestisce un'istanza per una comunità o un'organizzazione, oppure vuole ospitarla in proprio.
- Sviluppatori e volontari che vogliono migliorare il registry italiano dei broker.

## Cosa fa

| Funzione | Dettaglio |
|---|---|
| Richieste automatiche | Email in italiano (o inglese per broker esteri) con la delega firmata in allegato e i soli dati utili a identificarti |
| Azioni guidate | Per moduli web, telefono, PEC e Registro Pubblico delle Opposizioni: istruzioni e testo già compilato da copiare |
| Controllo scadenze | 30 giorni dall'invio (art. 12.3 GDPR), poi due solleciti automatici e uno manuale |
| Risposte | Ricevute via email e classificate: cancellazione confermata, rifiuto, richiesta di documento, richiesta di informazioni |
| Documento d'identità | Se un broker lo chiede lo carichi tu; viene inoltrato e **mai conservato** |
| Reclamo al Garante | Bozza di testo e PDF con cronologia dei fatti, più istruzioni per presentarlo |
| Rinnovi | Nuova verifica 90 giorni dopo ogni cancellazione |
| Richieste personalizzate | Per soggetti non presenti nel registry (fino a 10 al mese) |
| Famiglia | Fino a 5 profili per account (configurabile) |
| Report e notifiche | Report mensile, notifiche in app e per email (disattivabili) |
| Invio dalla tua casella | Le richieste partono dal tuo indirizzo (SMTP), con le risposte comunque tracciate da Cancellamy |
| Dossier probatorio | ZIP con cronologia, delega e messaggi, impronte SHA-256 e marca temporale facoltativa |
| "Cosa sai di me" | Richieste di accesso (art. 15) e mappa dei dati che i broker hanno su di te, con contatti verificati |
| Violazioni dei dati | Controllo delle tue email su Have I Been Pwned (funzione opzionale) |
| Deindicizzazione | Guida e tracciamento per togliere pagine dai risultati di Google e Bing |
| Classifica pubblica | Chi risponde davvero ai broker, solo dati aggregati e anonimi |
| Difesa dal telemarketing | Registro dei contatti indesiderati e segnalazione al Garante |
| I tuoi diritti | Esportazione di tutti i dati (art. 20) e cancellazione dell'account |

## Cosa NON fa (limiti onesti)

- **Non garantisce la cancellazione.** Ogni titolare decide; alcuni sono tenuti a conservare i dati per legge.
- **Non copre tutto internet.** Opera sui soggetti presenti nel registry. Il registry è curato dalla comunità e
  cresce nel tempo: guarda la pagina pubblica "Broker" per vedere cosa è coperto.
- **Non contatta in automatico** i soggetti per cui il recapito non è stato verificato da una persona sul sito
  ufficiale (restano visibili nel catalogo come "da verificare").
- **Non è un monitoraggio del dark web** né un servizio di ripristino dell'identità.
- **Non cancella dati alla fonte pubblica**: dati del registro imprese, centrali rischi e banche dati
  antiriciclaggio possono essere rifiutati per obbligo di legge; per le ditte individuali spesso funziona meglio
  l'opposizione (art. 21) che la cancellazione.
- **Non sostituisce un avvocato** nei casi complessi.

## Numeri del registry iniziale

| | |
|---|---|
| Soggetti nel registry | 492 |
| Con canale verificato (`verified`, a mano o con il controllo automatico DNS/MX) | 369 (368 contattati in automatico) |
| Con contatto da ricontrollare (`verified_needs_review`) | 12 |
| Con recapito da fonte aperta, non ancora controllato (`third_party`) | 51 |
| Senza recapito utilizzabile (`needs_research`) | 60 |
| Specifici dell'Italia (dominio `.it`, sede IT o ricerca italiana) | 84 |

Contare i soggetti non basta: conta quanti hanno un recapito verificato. Per questo il registry è la parte più
preziosa del progetto e il modo migliore per contribuire ([come](./04-registry.md#come-contribuire)).

## Principi del progetto

| Aspetto | Scelta di Cancellamy |
|---|---|
| Costo | Gratuito, software libero (AGPL-3.0) |
| Codice | Aperto e verificabile |
| Copertura | Registry orientato all'Italia e all'UE, con provenienza e licenza di ogni dato |
| Italia | Elenchi telefonici (DBU), aggregatori camerali, Registro delle Opposizioni, strumenti del Garante |
| Trasparenza | Elenco con recapiti, stato di verifica, ostacoli legali noti per ogni voce |
| Dati dell'utente | Cifrati a livello di campo; puoi ospitare l'istanza in proprio |

## Come è organizzato il progetto

- **Applicazione web** in italiano per gli utenti (`cancellamy-frontend`).
- **API e motore** che invia, legge, programma e controlla (`cancellamy-backend`).
- **Registry** dei soggetti da contattare (`registry/brokers.yaml`), con provenienza e licenza di ogni dato.
- **Modalità prova** (predefinita): le email vengono registrate ma non spedite e si possono simulare le risposte,
  così si vede il funzionamento senza contattare nessuno.

## Istanza pubblica e self-hosting

Il progetto prevede una **istanza pubblica ospitata dal maintainer** e il codice aperto (AGPL-3.0) perché chiunque possa
studiarlo, modificarlo e ospitare la propria. Le funzioni che dipendono da servizi esterni sono opzionali e si spengono
da sole se mancano le chiavi. Vedi [Funzionalità avanzate](./12-funzionalita-avanzate.md) e [Deploy](./06-deploy.md).

Prosegui con la [Guida utente](./02-guida-utente.md).
