export const AUTHORIZATION_TEXT_VERSION = '2026-10-v2';

/** Italian text of the delega signed by the user (also embedded in the PDF). */
export function buildAuthorizationText(fullName: string, operatorName: string): string {
  return [
    "MANDATO E DELEGA PER L'ESERCIZIO DEI DIRITTI IN MATERIA DI PROTEZIONE DEI DATI PERSONALI",
    '(ai sensi degli artt. 12, 15, 17, 18, 19, 21 e 22 del Regolamento (UE) 2016/679 - GDPR e del D.Lgs. 196/2003)',
    '',
    `Io sottoscritto/a ${fullName}, in qualità di interessato ai sensi dell'art. 4, punto 1) del Regolamento (UE) 2016/679 (GDPR), conferisco a ${operatorName} (di seguito "il Delegato") mandato con rappresentanza (artt. 1387 ss. c.c.) e delega scritta ad agire in mio nome e per mio conto nei confronti di qualsiasi titolare o responsabile del trattamento (inclusi data broker, fornitori di informazioni commerciali, elenchi pubblici o privati, aggregatori di dati, agenzie di marketing, motori di ricerca e soggetti analoghi) al fine di esercitare:`,
    '',
    '1. il diritto di revoca di qualsiasi eventuale consenso precedentemente prestato (art. 7, par. 3 GDPR);',
    '2. il diritto di accesso ai miei dati personali, inclusa la conferma del trattamento, copia integrale dei dati, l\'origine degli stessi e i destinatari cui sono stati comunicati (art. 15 GDPR);',
    '3. il diritto alla cancellazione ("diritto all\'oblio") senza ingiustificato ritardo di tutti i dati personali che mi riguardano (art. 17, par. 1, lett. a), b), c) e d) GDPR);',
    '4. il diritto di limitazione del trattamento nelle ipotesi previste dalla legge (art. 18 GDPR);',
    '5. il diritto di opposizione in qualsiasi momento al trattamento dei miei dati personali per finalità di marketing diretto, vendita, cessione a terzi o profilazione (art. 21, par. 1 e par. 2 GDPR), nonché a processi decisionali automatizzati (art. 22 GDPR);',
    '6. il diritto di ottenere la notifica della cancellazione, limitazione o opposizione a tutti i destinatari a cui i dati sono stati trasmessi (art. 19 GDPR);',
    '7. il potere di ricevere le comunicazioni e i riscontri dei titolari del trattamento (art. 12 GDPR), inviare solleciti formali e diffide ad adempiere, nonché predisporre, su mia richiesta, bozze di reclamo o segnalazione al Garante per la protezione dei dati personali (art. 77 GDPR e artt. 140-bis e 144 D.Lgs. 196/2003).',
    '',
    'Autorizzo espressamente il Delegato a trattare e comunicare ai suddetti titolari i dati identificativi da me forniti (nome, cognome, email, numero di telefono, indirizzi, data di nascita, codice fiscale ed eventuali alias) al solo ed esclusivo scopo di consentire la mia identificazione ed evadere le istanze, nonché a trasmettere copia della presente delega.',
    'Il Delegato non conserva copia dei miei documenti di identità: qualora un titolare ne dimostri la stretta necessità ai sensi dell\'art. 12, par. 6 GDPR, provvederò io stesso a trasmetterli tramite il servizio per il solo inoltro al titolare.',
    'Autorizzo il Delegato a inviare le richieste anche dal mio indirizzo email, se collego la mia casella di posta al servizio, e a ripetere periodicamente le richieste (di norma ogni 90 giorni) per verificare che i miei dati non siano stati raccolti di nuovo, a sollecitare i titolari che non rispondono entro i termini di legge e a trasmettere loro questa delega quando la richiedano.',
    'Il Delegato tratta i miei dati personali per queste finalità secondo l\'informativa privacy del servizio, che dichiaro di aver letto.',
    'La presente delega ha efficacia sino a revoca, che posso esercitare in qualsiasi momento dalla mia area personale: la revoca ferma l\'invio di nuove richieste e solleciti ma non annulla quelle già inviate.',
    'Prendo atto che il Delegato non è uno studio legale, non presta consulenza né rappresentanza processuale e che l\'effettiva cancellazione dipende dagli obblighi di legge applicabili a ciascun titolare.',
    '',
    'Sottoscritta elettronicamente dall\'interessato ai sensi del Regolamento (UE) n. 910/2014 (eIDAS) mediante autenticazione informatica, digitazione del proprio nome e cognome e accettazione espressa.',
  ].join('\n');
}
