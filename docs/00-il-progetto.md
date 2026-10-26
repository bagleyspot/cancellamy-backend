# 0 · Il progetto: perché esiste Cancellamy

## Perché è nato

Il GDPR dà a chiunque il diritto di chiedere la cancellazione dei propri dati (art. 17) e di opporsi al loro
trattamento (art. 21). In pratica però quasi nessuno lo esercita, perché farlo a mano verso decine di soggetti è
faticoso: bisogna scoprire chi ha i tuoi dati, trovare il recapito giusto (spesso nascosto in un'informativa), scrivere
una richiesta valida, ricordarsi la scadenza dei 30 giorni, sollecitare e, se nessuno risponde, rivolgersi al Garante.

Esistono servizi commerciali che automatizzano questo lavoro, ma sono a pagamento, chiusi e in generale non pensati per
il contesto italiano: Garante per la protezione dei dati personali, PEC, Registro Pubblico delle Opposizioni, banche dati
camerali e di sales intelligence che trattano dati di persone e ditte individuali italiane.

Cancellamy nasce per colmare questo vuoto con tre scelte precise:

- **Gratuito**: esercitare un diritto non dovrebbe costare un abbonamento.
- **Open source** (codice AGPL-3.0, registry CC BY-SA 4.0): chi gli affida i propri dati può leggere cosa fa, e chiunque
  può ospitarlo in proprio invece di fidarsi di una sola istanza.
- **Italiano**: interfaccia, testi legali, registry e documentazione sono pensati per chi vive in Italia.

## Cosa fa, in breve

L'utente inserisce i dati con cui è presente online e firma una **delega**. Cancellamy:

1. invia richieste di cancellazione e opposizione ai soggetti del [registry](./04-registry.md) con recapito verificato;
2. guida passo passo le azioni manuali (moduli web, telefono, PEC, Registro delle Opposizioni);
3. legge le risposte e aggiorna lo stato di ogni richiesta;
4. dopo 30 giorni senza risposta sollecita e prepara una bozza di reclamo al Garante;
5. ripete la richiesta ogni 90 giorni, perché i dati possono essere raccolti di nuovo.

I dettagli sono in [1 · Panoramica](./01-panoramica.md); i limiti (nessuna garanzia di cancellazione, nessun
monitoraggio del dark web, nessuna consulenza legale) sono dichiarati lì e in [9 · Sicurezza, privacy e aspetti
legali](./09-sicurezza-privacy-legale.md).

## Principi di progetto

- **Onestà sui limiti**: il registry indica per ogni soggetto gli ostacoli legali noti. Si contatta in automatico solo ciò
  che ha un recapito verificato.
- **Dati ridotti al minimo**: i dati personali sono cifrati a riposo (AES-256-GCM, a livello di campo) e i documenti
  d'identità non vengono mai conservati.
- **Sicuro per default**: con `MAIL_MODE=dry-run` le email vengono registrate ma non inviate.
- **Licenze pulite**: il registry non riusa recapiti da fonti con licenza non commerciale (vedi
  [ATTRIBUTION](../registry/ATTRIBUTION.md)).

## Dove trovare il progetto

| Cosa | Dove |
|---|---|
| **Backend** (API, motore delle richieste, registry, documentazione, stack di self-hosting): NestJS, TypeScript, MongoDB | <https://github.com/bagleyspot/cancellamy-backend> |
| **Frontend** (applicazione web in italiano): React, Vite, Tailwind | <https://github.com/bagleyspot/cancellamy-frontend> |
| **Demo online** del frontend | <https://cancellamy-frontend.vercel.app/> |

I due repository vanno clonati affiancati nella stessa cartella (vedi [5 · Installazione e
configurazione](./05-installazione-e-configurazione.md)). Il contratto tra i due è in [API-CONTRACT.md](./API-CONTRACT.md).

> La demo online mostra l'interfaccia web. Per usare il servizio da capo a fondo serve un backend raggiungibile: si
> avvia in locale o con lo stack di [self-hosting](../selfhost/README.md).

## Come partecipare

- Vuoi usarlo o ospitarlo? Parti dalla [guida utente](./02-guida-utente.md) o dal [deploy](./06-deploy.md).
- Vuoi migliorare il registry (il contributo più prezioso)? Leggi [4 · Registry](./04-registry.md#come-contribuire).
- Vuoi sviluppare? Leggi [11 · Sviluppo e contributi](./11-sviluppo-e-contributi.md) e `CONTRIBUTING.md`.
- Hai trovato una vulnerabilità? Segui `SECURITY.md`.

> Cancellamy non è uno studio legale e non fornisce consulenza legale.
