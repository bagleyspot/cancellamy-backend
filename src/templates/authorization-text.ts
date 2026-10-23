export const AUTHORIZATION_TEXT_VERSION = '2026-10-v1';

/** Italian text of the delega signed by the user (also embedded in the PDF). */
export function buildAuthorizationText(fullName: string, operatorName: string): string {
  return [
    "DELEGA PER L'ESERCIZIO DEI DIRITTI IN MATERIA DI PROTEZIONE DEI DATI PERSONALI",
    '',
    `Io sottoscritto/a ${fullName}, in qualità di interessato ai sensi del Regolamento (UE) 2016/679 (GDPR), conferisco a ${operatorName} (di seguito "il Delegato") delega scritta ad agire in mio nome e per mio conto nei confronti dei titolari del trattamento (data broker, elenchi, aggregatori di dati, motori di ricerca e soggetti analoghi) per esercitare:`,
    '',
    '1. il diritto alla cancellazione dei miei dati personali (art. 17 GDPR);',
    '2. il diritto di opposizione al trattamento, in particolare per marketing diretto, profilazione e cessione a terzi (art. 21 GDPR);',
    '3. i connessi diritti di ottenere riscontro e comunicazione ai destinatari (artt. 12 e 19 GDPR) e, in caso di mancato riscontro, di sollecitare il titolare;',
    '4. la predisposizione, a mia richiesta, di una bozza di reclamo al Garante per la protezione dei dati personali (art. 77 GDPR), che resto libero di presentare personalmente.',
    '',
    'Autorizzo il Delegato a utilizzare i dati identificativi da me forniti (nome, email, telefono, indirizzi, data di nascita, codice fiscale e altri dati facoltativi) esclusivamente per identificarmi presso i titolari e per gestire le richieste, e a trasmettere questa delega ai titolari che la richiedano.',
    "Il Delegato non conserva copia dei miei documenti di identità: se un titolare li richiede, li invierò io stesso tramite il servizio ed essi saranno inoltrati al titolare senza essere salvati.",
    "Posso revocare questa delega in qualsiasi momento dall'area personale: la revoca ferma l'invio di nuove richieste e solleciti ma non annulla quelle già inviate.",
    "Il Delegato non è uno studio legale e non fornisce consulenza legale; non può garantire la cancellazione dei dati, che dipende dalle risposte dei titolari e dalla legge applicabile.",
    '',
    'Sottoscritta con firma elettronica semplice: digitazione del mio nome e cognome e accettazione esplicita.',
  ].join('\n');
}
