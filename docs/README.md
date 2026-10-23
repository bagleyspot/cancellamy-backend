# Documentazione di Cancellamy

Cancellamy è un servizio **gratuito e open source (AGPL-3.0)** che esercita per tuo conto i diritti previsti dal GDPR
nei confronti di data broker e altri soggetti che trattano i tuoi dati in Italia: invia richieste di cancellazione e
opposizione (artt. 17 e 21), controlla le scadenze, sollecita, riprova periodicamente e ti prepara il reclamo al
Garante quando nessuno risponde.

Questa documentazione è pensata per tre tipi di lettori. Parti dalla colonna che ti riguarda.

| Sei... | Leggi |
|---|---|
| **Una persona che vuole proteggere i propri dati** | [1 · Panoramica](./01-panoramica.md) → [2 · Guida utente](./02-guida-utente.md) |
| **Chi installa e gestisce un'istanza** (pubblica o personale) | [5 · Installazione e configurazione](./05-installazione-e-configurazione.md) → [6 · Deploy e self-hosting](./06-deploy.md) → [12 · Funzionalità avanzate](./12-funzionalita-avanzate.md) → [9 · Sicurezza, privacy e aspetti legali](./09-sicurezza-privacy-legale.md) → [10 · Operazioni](./10-operazioni.md) |
| **Chi sviluppa o contribuisce** | [7 · Architettura](./07-architettura.md) → [8 · API](./08-api.md) → [4 · Registry](./04-registry.md) → [11 · Sviluppo e contributi](./11-sviluppo-e-contributi.md) |

## Indice

1. [Panoramica](./01-panoramica.md): che cos'è, cosa fa e cosa non fa, limiti onesti, architettura del servizio.
2. [Guida utente](./02-guida-utente.md): dalla registrazione al reclamo al Garante, schermata per schermata, con FAQ e glossario.
3. [Ciclo di vita delle richieste](./03-ciclo-di-vita-delle-richieste.md): stati, tempi, solleciti, rinnovi, risposte dei broker.
4. [Il registry dei broker](./04-registry.md): formato, stati di verifica, regole di invio automatico, come contribuire.
5. [Installazione e configurazione](./05-installazione-e-configurazione.md): requisiti, avvio locale, tutte le variabili d'ambiente, Resend.
6. [Deploy](./06-deploy.md): Docker, Cloud Run, MongoDB Atlas, Cloud Scheduler, frontend, checklist di messa in produzione.
7. [Architettura](./07-architettura.md): componenti, moduli, modello dati, sicurezza, multi-istanza.
8. [API](./08-api.md): autenticazione, errori, esempi, riferimento completo.
9. [Sicurezza, privacy e aspetti legali](./09-sicurezza-privacy-legale.md): cosa conserviamo, come lo proteggiamo, ruoli, DPIA.
10. [Operazioni](./10-operazioni.md): monitoraggio, runbook, risoluzione dei problemi.
11. [Sviluppo e contributi](./11-sviluppo-e-contributi.md): struttura dei repo, test, come estendere il progetto, limiti noti.
12. [Funzionalità avanzate](./12-funzionalita-avanzate.md): invio dalla propria casella, dossier probatorio, verifica dei contatti e "Cosa sai di me", violazioni dei dati, deindicizzazione, classifica pubblica, difesa dal telemarketing.

## I due repository

| Repo | Contenuto | Stack |
|---|---|---|
| `cancellamy-backend` | API, motore delle richieste, scheduler, registry (`registry/brokers.yaml`), stack di self-hosting (`selfhost/`), questa documentazione | NestJS 11, TypeScript strict, MongoDB, Jest |
| `cancellamy-frontend` | Applicazione web (italiano) | React 19, Vite 7, Tailwind 4, TanStack Query, Vitest |

## Avviso importante

Cancellamy **non è uno studio legale** e non fornisce consulenza legale. Non può garantire che un broker cancelli i
tuoi dati: dipende dalle risposte dei titolari e dalla legge applicabile. Centrali rischi, banche dati
antiriciclaggio e registri pubblici possono rifiutare legittimamente.
