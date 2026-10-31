# 4 · Il registry dei broker

Il registry è l'elenco dei soggetti a cui Cancellamy può chiedere la cancellazione. È un file YAML nel repository,
[`registry/brokers.yaml`](../registry/brokers.yaml), caricato nel database all'avvio. È il patrimonio più prezioso
del progetto: un elenco lungo ma non verificato è pericoloso (scrivere a indirizzi sbagliati) e inutile.

## Principi

1. **Provenienza e licenza per ogni dato.** Ogni voce dichiara da dove vengono le informazioni e con quale licenza.
2. **Verifica prima dell'invio.** Si scrive in automatico solo a recapiti verificati: letti da una persona sul sito
   ufficiale del soggetto oppure validati dal controllo automatico (DNS/MX, coerenza di dominio, crawler della pagina
   privacy). Il controllo automatico è più debole di quello umano: confermare a mano un recapito è il contributo più
   utile.
3. **Onestà sugli ostacoli.** Ogni voce riporta la base giuridica più adatta e i limiti noti alla cancellazione.
4. **Niente copia di dati non riutilizzabili.** Le voci che derivano da elenchi con licenza CC BY-NC-SA conservano
   solo nome e URL (fatti), non recapiti né note.

## Stati di verifica (`verification.status`)

| Stato | Significato | Invio automatico |
|---|---|---|
| `verified` | Un canale è stato verificato sul sito ufficiale del soggetto o tramite validazione automatica DNS/MX e crawler privacy | **Sì** (se la categoria lo consente) |
| `verified_needs_review` | Letto sul sito ufficiale ma da ricontrollare (form illeggibili per JavaScript, email decodificate, policy datate) | No (un admin può abilitarlo) |
| `third_party` | Recapito preso da un dataset aperto (ad esempio datenanfragen, CC0), non ancora controllato | No |
| `needs_research` | Nessun recapito utilizzabile | No |

Stato attuale: 381 `verified` (379 contattati automaticamente), 20 `verified_needs_review`, 50 `third_party`, 41 `needs_research` (totale 492).
Dei 381 `verified`, 129 hanno almeno una fonte letta sul sito ufficiale (`verified_on_official_site`); gli altri sono validati solo
da dataset aperti o dal controllo automatico.

## Automazione della verifica e scoperta contatti

Cancellamy include un motore automatico (`BrokerVerifierService` e CLI `npm run verify:brokers`) che:

1. **Valida i canali email via DNS/MX e coerenza di dominio**: controlla sintassi, assenza di caselle `noreply`, corrispondenza del dominio/brand o appartenenza a rappresentanti GDPR riconosciuti (VeraSafe, EDPO, DP-Dock, PrivacyLab, ecc.) e verifica l'esistenza di record DNS MX/A attivi.
2. **Scansiona le pagine privacy ufficiali (Crawler GDPR)**: per le voci prive di email, ispeziona il sito ufficiale e le pagine `/privacy`, `/privacy-policy`, `/informativa-privacy`, `/gdpr`, `/datenschutz`, decodificando anche le email offuscate da Cloudflare (`data-cfemail`) e validandone il record MX.
   Il crawler segue solo link `http(s)` sulle porte 80/443, verso indirizzi pubblici (nessun host interno, nessun indirizzo
   privato, anche dopo un redirect) e al massimo 3 redirect.
3. **Espone il comando in Area Admin**: tramite `POST /api/v1/admin/brokers/auto-verify` (pulsante **«Verifica automatica contatti»** in Admin → Broker) l'amministratore può lanciare in qualsiasi momento la verifica automatica sui broker presenti nel database.

## Quando una voce è contattata in automatico

Una voce ha `sendEnabled` attivo all'importazione se e solo se:

- `verification.status` è `verified`, **e**
- la categoria **non** è tra quelle escluse per impostazione predefinita:
  `regulator`, `credit_bureau`, `kyc_pep`, `business_register`, `public_records` (l'erasure è limitata per legge o il
  soggetto è l'autorità), **e**
- esiste almeno un canale `email`, `pec`, `web_form` o `phone`.

Un amministratore può cambiare `sendEnabled`, lo stato di verifica, i canali e le note dall'area admin. **Le
modifiche dell'admin non vengono sovrascritte** da un successivo caricamento del file (`adminEdited`).

## Pertinenza: `markets` e `hq_country`

`markets` dice dove opera il soggetto (codici ISO come `IT`, `DE`; oppure `ALL`, `EU`, `EEA`); se manca si usa la sede,
`hq_country`. Servono a scegliere e ordinare i soggetti per ogni profilo (vedi
[Quali soggetti riceve un profilo](./03-ciclo-di-vita-delle-richieste.md#quali-soggetti-riceve-un-profilo)): **una voce senza
né `markets` né `hq_country` non viene contattata in automatico** (con `BROKER_RELEVANCE=prioritize` o `strict`). Quando
aggiungi o verifichi una voce, indica anche i mercati (un admin può impostarli dalla `PATCH /admin/brokers/:id`; le modifiche non vengono sovrascritte dal reseed). Il caricamento ricava inoltre `officialSiteVerified` (vero se almeno una
fonte in `provenance` ha `verified_on_official_site: true`), che serve a contattare per primi i soggetti verificati sul sito
ufficiale.

## Formato di una voce

```yaml
- id: lusha                       # identificatore stabile (slug)
  name: Lusha
  website: https://www.lusha.com
  domain: lusha.com               # dominio registrabile, usato per abbinare le risposte
  category: b2b_enrichment
  hq_country: US
  markets: [IT, DE]               # dove opera: codici paese ISO, oppure ALL / EU / EEA; vuoto = da classificare
  channels:
    - type: email                 # email | pec | web_form | phone | postal | other
      value: privacy@lusha.com
      verified: true              # letto sul sito ufficiale
      label: opt-out              # facoltativo
  legal_basis_note: art17, art21  # base giuridica che di solito funziona
  obstacles: ...                  # cosa limita la cancellazione
  id_requested: maybe             # yes | no | maybe | not-stated
  verification:
    status: verified
    last_verified: '2026-10-23'
  notes: ...
  provenance:                     # da dove vengono i dati
    - stream: D                   # flusso di ricerca (A, B, C, D)
      ref: https://www.lusha.com/legal/privacy-policy/
      license: own-research
      verified_on_official_site: true
  stream_origin: [D]
```

Campi obbligatori all'importazione: `id`, `name`, `category`. Id duplicati bloccano il caricamento (errore chiaro nei
log: l'API continua a funzionare con i dati già presenti).

### Categorie

| Categoria | Cosa include | Note |
|---|---|---|
| `b2b_enrichment` | Strumenti di contatti e "sales intelligence" (Lusha, Apollo, ZoomInfo...) | La più rilevante per il rischio reale |
| `business_info` | Informazioni commerciali (Cerved, Atoka, Cribis...) | Utile per ditte individuali e professionisti |
| `phone_directory` | Elenchi telefonici (PagineBianche, PagineGialle) | La cancellazione vera passa dall'operatore telefonico (DBU) |
| `caller_id_app` | Identificazione chiamate (Truecaller...) | |
| `reverse_lookup` | Ricerca inversa di numeri | |
| `people_search` | Siti di ricerca persone | Pochi in Italia, più diffusi all'estero |
| `marketing_adtech`, `data_broker`, `address_data`, `lead_seller` | Marketing, dati indirizzi, liste | |
| `recruitment`, `risk_mitigation` | Reclutamento, verifiche di rischio | |
| `search_engine` | Motori di ricerca (deindicizzazione) | Azione manuale |
| `news_archive` | Archivi di notizie | Si lavora su deindicizzazione e diritto all'oblio |
| `opposition_register` | Registro Pubblico delle Opposizioni | Blocca contatti commerciali, **non cancella** |
| `credit_bureau`, `kyc_pep`, `business_register`, `public_records` | Centrali rischi, banche dati antiriciclaggio, registri pubblici | Escluse dall'invio automatico: cancellano solo dati inesatti o illeciti |
| `regulator` | Garante privacy | Mai contattato: serve per il reclamo |
| `other` | Altro | |

## Origine dei dati e licenze

Il registry è la fusione di sei filoni di ricerca (23 ottobre 2026) più la verifica G del 31 ottobre 2026:

| Flusso | Contenuto | Licenza dei dati |
|---|---|---|
| **A** | Directory pubbliche di data broker (solo nomi, categorie e indicazione di copertura) | Fatti pubblici |
| **B** | Dataset aperti: datenanfragen/data (CC0), drumandbytes/eraser (MIT), registro della California, studio EDPB sui data broker belgi | Per ogni voce in `provenance[].license` |
| **C** | Ricerca originale su soggetti italiani ed europei (elenchi, aggregatori, centrali rischi, strumenti del Garante) | `own-research` |
| **D** | Ricerca originale su fornitori B2B | `own-research` |
| **F** | Elenco pubblico delle 36 aziende aderenti ad **ANCIC** (informazioni commerciali) dal portale `informativaprivacyancic.it`: 18 nuove voci italiane `needs_research` e il riferimento ANCIC su 18 voci già presenti | Fatti pubblici (solo nomi) |
| **G** | Verifica manuale dei soggetti italiani sui loro siti ufficiali (31 ottobre 2026): 22 voci, ognuna con l'URL della pagina letta | `own-research` |
| **E** | Elenco di [DataBrokersWatch.org](https://databrokerswatch.org) (export CSV del 23 ottobre 2026): 47 soggetti UE/UK/CH o con contatto DPO/GDPR non ancora nel registry, più recapiti privacy aggiunti a 26 voci esistenti | **CC BY-SA 4.0**: attribuzione obbligatoria (`registry/ATTRIBUTION.md`); i dati derivati restano CC BY-SA 4.0 |

Fonti **non riutilizzabili** per i recapiti (CC BY-NC-SA 4.0: BADBOOL, Optery, markramm, Privacy Rights
Clearinghouse) sono state usate solo come indicazioni di nomi da verificare.

## Come contribuire

Il contributo più utile è **verificare un recapito**:

1. Scegli una voce `third_party`, `verified_needs_review` o `needs_research` (l'area admin e il catalogo pubblico
   le mostrano).
2. Vai sul **sito ufficiale** del soggetto e trova la pagina privacy o il modulo per l'esercizio dei diritti.
3. Annota l'URL esatto da cui leggi il recapito e la data.
4. Modifica la voce in `registry/brokers.yaml`: aggiorna `channels` (con `verified: true`), `verification.status`
   (`verified`), `last_verified`, `provenance` (`ref` = URL, `license: own-research`,
   `verified_on_official_site: true`) e, se serve, `obstacles` e `legal_basis_note`.
5. Apri una pull request. Non copiare mai recapiti da elenchi con licenza non compatibile.

Aggiungere un **nuovo** soggetto: stessi campi, con `id` univoco in minuscolo e `category` valida.

Dopo il merge, l'istanza ricarica il registry al riavvio (`SEED_ON_BOOT`) o con **Admin → Broker → Risincronizza il
registro**.

## Licenza del registry

Il codice è AGPL-3.0-only; **i dati in `registry/` sono CC BY-SA 4.0** (`registry/LICENSE`). Chi riusa il registry deve
attribuire il progetto e le fonti (`registry/ATTRIBUTION.md`, `registry/THIRD-PARTY-NOTICES.md`) e redistribuire le
modifiche con la stessa licenza. Contribuendo al registry accetti di rilasciare i tuoi dati con CC BY-SA 4.0.

## Cosa non devi mai fare

- Non marcare `verified` un recapito che non hai letto sul sito ufficiale o che non ha superato il controllo automatico.
- Non inserire dati personali di persone nel registry.
- Non copiare contenuti da fonti protette da licenza non compatibile con CC BY-SA 4.0 (la licenza del registry).

## Limiti noti del registry

- Il Garante ha sospeso, su ordinanza del Tribunale di Roma (8 settembre 2026), una sanzione verso Lusha: la voce lo
  riporta; non va considerato un precedente consolidato.
- Alcuni siti (Kompass, Infobel, 192.com, PagesJaunes e altri) bloccano la lettura automatica: servono verifiche a
  mano.
- Non esiste un elenco ufficiale di data broker in Italia né in UE: il registry è una compilazione del progetto.
- I venditori di liste di marketing italiani non emergono dai provvedimenti del Garante (i nomi sono oscurati).
