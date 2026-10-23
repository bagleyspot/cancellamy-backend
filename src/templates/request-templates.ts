import { ProfilePii, formatAddress, fullName } from '../profiles/profile.types';

export type Lang = 'it' | 'en';

export interface RequestEmailContext {
  lang: Lang;
  brokerName: string;
  shortRef: string;
  operatorName: string;
  pii: ProfilePii;
  cycle: number;
  /** Defaults to erasure. Access requests use art. 15 wording. */
  kind?: 'erasure' | 'access';
  /** ISO date (YYYY-MM-DD) of the first request for reminders / renewals. */
  firstSentOn?: string;
  /** Deadline date shown in reminders. */
  dueOn?: string;
}

export interface EmailContent {
  subject: string;
  text: string;
}

function identifyingData(pii: ProfilePii, lang: Lang): string[] {
  const l =
    lang === 'it'
      ? {
          name: 'Nome e cognome',
          alias: 'Altre grafie del nome',
          email: 'Email',
          phone: 'Telefono',
          address: 'Indirizzo',
          dob: 'Data di nascita',
          cf: 'Codice fiscale',
        }
      : {
          name: 'Full name',
          alias: 'Other spellings of the name',
          email: 'Email',
          phone: 'Phone',
          address: 'Address',
          dob: 'Date of birth',
          cf: 'Tax code',
        };
  const lines = [`- ${l.name}: ${fullName(pii)}`];
  if (pii.aliases.length) lines.push(`- ${l.alias}: ${pii.aliases.join('; ')}`);
  if (pii.emails.length) lines.push(`- ${l.email}: ${pii.emails.join('; ')}`);
  if (pii.phones.length) lines.push(`- ${l.phone}: ${pii.phones.join('; ')}`);
  for (const a of pii.addresses) lines.push(`- ${l.address}: ${formatAddress(a)}`);
  if (pii.dateOfBirth) lines.push(`- ${l.dob}: ${pii.dateOfBirth}`);
  if (pii.fiscalCode) lines.push(`- ${l.cf}: ${pii.fiscalCode}`);
  return lines;
}

export function erasureEmail(ctx: RequestEmailContext): EmailContent {
  const name = fullName(ctx.pii);
  const renewal = ctx.cycle > 1;
  if (ctx.lang === 'it') {
    return {
      subject: `Richiesta di cancellazione e opposizione (artt. 17 e 21 GDPR) - ${name} [${ctx.shortRef}]`,
      text: [
        `Spett.le ${ctx.brokerName},`,
        "alla cortese attenzione del Responsabile della protezione dei dati (DPO) / Ufficio Privacy",
        '',
        `${name} (di seguito "l'interessato") ha incaricato ${ctx.operatorName} di esercitare in suo nome i diritti previsti dal Regolamento (UE) 2016/679 (GDPR). La delega scritta e sottoscritta dall'interessato è allegata a questa email.`,
        '',
        renewal
          ? `Questa è una richiesta periodica di verifica (ciclo ${ctx.cycle}): i dati potrebbero essere stati raccolti di nuovo dopo la precedente richiesta${ctx.firstSentOn ? ` del ${ctx.firstSentOn}` : ''}.`
          : '',
        renewal ? '' : undefined,
        "L'interessato chiede, ai sensi degli artt. 17 e 21 GDPR:",
        '1. la cancellazione senza ingiustificato ritardo di tutti i dati personali che lo riguardano, in qualsiasi banca dati, prodotto o servizio della vostra organizzazione;',
        '2. di cessare ogni trattamento dei suoi dati per marketing diretto, profilazione, cessione o comunicazione a terzi, inserendolo in una lista di soppressione affinché i dati non siano raccolti di nuovo;',
        "3. la comunicazione della cancellazione ai destinatari ai quali i dati sono stati trasmessi (art. 19);",
        "4. un riscontro scritto entro un mese dal ricevimento (art. 12, par. 3), con l'indicazione delle azioni svolte oppure, se non trattate dati che lo riguardano, la relativa conferma.",
        '',
        "Dati utili a identificare l'interessato:",
        ...identifyingData(ctx.pii, 'it'),
        '',
        `Potete rispondere a questa email citando il riferimento ${ctx.shortRef}. Se per identificare l'interessato ritenete indispensabile un documento di identità, indicatelo nella risposta: sarà trasmesso in modo sicuro. Vi chiediamo di non richiederlo se i dati già forniti sono sufficienti (principio di minimizzazione, art. 5 GDPR).`,
        '',
        "In mancanza di riscontro nel termine di legge l'interessato potrà proporre reclamo al Garante per la protezione dei dati personali (art. 77 GDPR) e agire in sede giurisdizionale.",
        '',
        'Cordiali saluti,',
        name,
        `per delega, tramite ${ctx.operatorName}`,
        `Riferimento: ${ctx.shortRef}`,
      ]
        .filter((l): l is string => l !== undefined)
        .join('\n'),
    };
  }
  return {
    subject: `GDPR erasure and objection request (Art. 17 and 21) - ${name} [${ctx.shortRef}]`,
    text: [
      `Dear ${ctx.brokerName},`,
      'For the attention of the Data Protection Officer / Privacy team',
      '',
      `${name} (the "data subject") has appointed ${ctx.operatorName} to exercise, on their behalf, the rights granted by Regulation (EU) 2016/679 (GDPR). The written authorisation signed by the data subject is attached to this email.`,
      '',
      renewal
        ? `This is a periodic follow-up request (cycle ${ctx.cycle}): the data may have been collected again after the previous request${ctx.firstSentOn ? ` of ${ctx.firstSentOn}` : ''}.`
        : '',
      renewal ? '' : undefined,
      'Pursuant to Articles 17 and 21 GDPR, the data subject requests:',
      '1. the erasure without undue delay of all personal data relating to them, in any database, product or service of your organisation;',
      '2. that you stop any processing of their data for direct marketing, profiling, sale or disclosure to third parties, and add them to a suppression list so that the data are not collected again;',
      '3. that you notify the erasure to the recipients to whom the data were disclosed (Art. 19);',
      '4. a written reply within one month of receipt (Art. 12(3)), describing the action taken or, if you hold no data about them, confirming it.',
      '',
      'Information to identify the data subject:',
      ...identifyingData(ctx.pii, 'en'),
      '',
      `You can reply to this email quoting the reference ${ctx.shortRef}. If you consider an identity document strictly necessary, say so in your reply and it will be sent securely; please do not ask for it if the data above are sufficient (data minimisation, Art. 5 GDPR).`,
      '',
      'If no reply is received within the legal deadline, the data subject may lodge a complaint with the supervisory authority (Art. 77 GDPR) and seek a judicial remedy.',
      '',
      'Kind regards,',
      name,
      `on behalf of the data subject, via ${ctx.operatorName}`,
      `Reference: ${ctx.shortRef}`,
    ]
      .filter((l): l is string => l !== undefined)
      .join('\n'),
  };
}

export function accessEmail(ctx: RequestEmailContext): EmailContent {
  const name = fullName(ctx.pii);
  if (ctx.lang === 'it') {
    return {
      subject: `Richiesta di accesso ai dati personali (art. 15 GDPR) - ${name} [${ctx.shortRef}]`,
      text: [
        `Spett.le ${ctx.brokerName},`,
        'alla cortese attenzione del Responsabile della protezione dei dati (DPO) / Ufficio Privacy',
        '',
        `${name} (di seguito "l'interessato") ha incaricato ${ctx.operatorName} di esercitare in suo nome i diritti previsti dal Regolamento (UE) 2016/679 (GDPR). La delega scritta e sottoscritta dall'interessato è allegata a questa email.`,
        '',
        "L'interessato chiede, ai sensi dell'art. 15 GDPR:",
        '1. la conferma che sia o meno in corso un trattamento di dati personali che lo riguardano;',
        '2. in caso affermativo, una copia dei dati personali oggetto di trattamento e le informazioni di cui all\'art. 15, par. 1: finalità, categorie di dati, destinatari o categorie di destinatari (anche in paesi terzi), periodo di conservazione o criteri per determinarlo, origine dei dati se non raccolti presso l\'interessato, esistenza di processi decisionali automatizzati o di profilazione (art. 22);',
        "3. un riscontro scritto entro un mese dal ricevimento (art. 12, par. 3), possibilmente in un formato elettronico di uso comune (art. 15, par. 3).",
        '',
        "Dati utili a identificare l'interessato:",
        ...identifyingData(ctx.pii, 'it'),
        '',
        `Potete rispondere a questa email citando il riferimento ${ctx.shortRef}. Se per identificare l'interessato ritenete indispensabile un documento di identità, indicatelo nella risposta: sarà trasmesso in modo sicuro. Vi chiediamo di non richiederlo se i dati già forniti sono sufficienti (principio di minimizzazione, art. 5 GDPR).`,
        '',
        "In mancanza di riscontro nel termine di legge l'interessato potrà proporre reclamo al Garante per la protezione dei dati personali (art. 77 GDPR) e agire in sede giurisdizionale.",
        '',
        'Cordiali saluti,',
        name,
        `per delega, tramite ${ctx.operatorName}`,
        `Riferimento: ${ctx.shortRef}`,
      ].join('\n'),
    };
  }
  return {
    subject: `GDPR access request (Art. 15) - ${name} [${ctx.shortRef}]`,
    text: [
      `Dear ${ctx.brokerName},`,
      'For the attention of the Data Protection Officer / Privacy team',
      '',
      `${name} (the "data subject") has appointed ${ctx.operatorName} to exercise, on their behalf, the rights granted by Regulation (EU) 2016/679 (GDPR). The written authorisation signed by the data subject is attached to this email.`,
      '',
      'Pursuant to Article 15 GDPR, the data subject requests:',
      '1. confirmation as to whether or not personal data concerning them are being processed;',
      '2. where that is the case, a copy of the personal data undergoing processing and the information listed in Art. 15(1): purposes, categories of data, recipients or categories of recipients (including in third countries), retention period or criteria, the source of the data if not collected from the data subject, and the existence of automated decision-making or profiling (Art. 22);',
      '3. a written reply within one month of receipt (Art. 12(3)), preferably in a commonly used electronic format (Art. 15(3)).',
      '',
      'Information to identify the data subject:',
      ...identifyingData(ctx.pii, 'en'),
      '',
      `You can reply to this email quoting the reference ${ctx.shortRef}. If you consider an identity document strictly necessary, say so in your reply and it will be sent securely; please do not ask for it if the data above are sufficient (data minimisation, Art. 5 GDPR).`,
      '',
      'If no reply is received within the legal deadline, the data subject may lodge a complaint with the supervisory authority (Art. 77 GDPR) and seek a judicial remedy.',
      '',
      'Kind regards,',
      name,
      `on behalf of the data subject, via ${ctx.operatorName}`,
      `Reference: ${ctx.shortRef}`,
    ].join('\n'),
  };
}

export function reminderEmail(ctx: RequestEmailContext & { reminderNumber: number }): EmailContent {
  const name = fullName(ctx.pii);
  if (ctx.kind === 'access') {
    const it = ctx.lang === 'it';
    return it
      ? {
          subject: `Sollecito n. ${ctx.reminderNumber}: richiesta di accesso (art. 15 GDPR) - ${name} [${ctx.shortRef}]`,
          text: [
            `Spett.le ${ctx.brokerName},`,
            '',
            `facciamo seguito alla richiesta di accesso ai dati personali inviata${ctx.firstSentOn ? ` il ${ctx.firstSentOn}` : ''} (riferimento ${ctx.shortRef}) per conto di ${name}.`,
            `Il termine di un mese previsto dall'art. 12, par. 3 GDPR${ctx.dueOn ? ` (scaduto il ${ctx.dueOn})` : ''} risulta decorso senza riscontro.`,
            '',
            "Vi chiediamo di rispondere con urgenza fornendo la conferma del trattamento e la copia dei dati. In mancanza, l'interessato valuterà un reclamo al Garante per la protezione dei dati personali (art. 77 GDPR).",
            '',
            'Cordiali saluti,',
            name,
            `per delega, tramite ${ctx.operatorName}`,
            `Riferimento: ${ctx.shortRef}`,
          ].join('\n'),
        }
      : {
          subject: `Reminder no. ${ctx.reminderNumber}: GDPR access request (Art. 15) - ${name} [${ctx.shortRef}]`,
          text: [
            `Dear ${ctx.brokerName},`,
            '',
            `we refer to the access request sent${ctx.firstSentOn ? ` on ${ctx.firstSentOn}` : ''} (reference ${ctx.shortRef}) on behalf of ${name}.`,
            `The one-month deadline of Art. 12(3) GDPR${ctx.dueOn ? ` (expired on ${ctx.dueOn})` : ''} has elapsed without a reply.`,
            '',
            'Please reply urgently with the confirmation of processing and a copy of the data. Absent a reply, the data subject will consider lodging a complaint with the supervisory authority (Art. 77 GDPR).',
            '',
            'Kind regards,',
            name,
            `on behalf of the data subject, via ${ctx.operatorName}`,
            `Reference: ${ctx.shortRef}`,
          ].join('\n'),
        };
  }
  if (ctx.lang === 'it') {
    return {
      subject: `Sollecito n. ${ctx.reminderNumber}: richiesta di cancellazione (artt. 17 e 21 GDPR) - ${name} [${ctx.shortRef}]`,
      text: [
        `Spett.le ${ctx.brokerName},`,
        '',
        `facciamo seguito alla richiesta di cancellazione e opposizione inviata${ctx.firstSentOn ? ` il ${ctx.firstSentOn}` : ''} (riferimento ${ctx.shortRef}) per conto di ${name}.`,
        `Il termine di un mese previsto dall'art. 12, par. 3 GDPR${ctx.dueOn ? ` (scaduto il ${ctx.dueOn})` : ''} risulta decorso senza che abbiamo ricevuto riscontro.`,
        '',
        'Vi chiediamo di rispondere con urgenza a questa email confermando la cancellazione dei dati o indicando i motivi che la impediscono. In mancanza di riscontro, l’interessato valuterà un reclamo al Garante per la protezione dei dati personali (art. 77 GDPR).',
        '',
        'Cordiali saluti,',
        name,
        `per delega, tramite ${ctx.operatorName}`,
        `Riferimento: ${ctx.shortRef}`,
      ].join('\n'),
    };
  }
  return {
    subject: `Reminder no. ${ctx.reminderNumber}: GDPR erasure request (Art. 17 and 21) - ${name} [${ctx.shortRef}]`,
    text: [
      `Dear ${ctx.brokerName},`,
      '',
      `we refer to the erasure and objection request sent${ctx.firstSentOn ? ` on ${ctx.firstSentOn}` : ''} (reference ${ctx.shortRef}) on behalf of ${name}.`,
      `The one-month deadline of Art. 12(3) GDPR${ctx.dueOn ? ` (expired on ${ctx.dueOn})` : ''} has elapsed and we have not received a reply.`,
      '',
      'Please reply urgently to this email, confirming the erasure or stating the reasons that prevent it. Absent a reply, the data subject will consider lodging a complaint with the supervisory authority (Art. 77 GDPR).',
      '',
      'Kind regards,',
      name,
      `on behalf of the data subject, via ${ctx.operatorName}`,
      `Reference: ${ctx.shortRef}`,
    ].join('\n'),
  };
}

export function idProvidedEmail(ctx: RequestEmailContext, note?: string): EmailContent {
  const name = fullName(ctx.pii);
  if (ctx.lang === 'it') {
    return {
      subject: `Documento di identità richiesto - ${name} [${ctx.shortRef}]`,
      text: [
        `Spett.le ${ctx.brokerName},`,
        '',
        `in riscontro alla vostra richiesta di identificazione relativa alla pratica ${ctx.shortRef}, in allegato trovate il documento di identità di ${name}, trasmesso esclusivamente per verificarne l'identità.`,
        "Vi chiediamo di non conservarlo oltre il tempo necessario alla verifica e di dare seguito alla richiesta di cancellazione già inviata.",
        note ? `\nNota dell'interessato: ${note}` : '',
        '',
        'Cordiali saluti,',
        name,
        `per delega, tramite ${ctx.operatorName}`,
        `Riferimento: ${ctx.shortRef}`,
      ].join('\n'),
    };
  }
  return {
    subject: `Identity document requested - ${name} [${ctx.shortRef}]`,
    text: [
      `Dear ${ctx.brokerName},`,
      '',
      `in reply to your identification request about case ${ctx.shortRef}, please find attached the identity document of ${name}, sent solely to verify their identity.`,
      'Please do not retain it longer than needed for the verification and proceed with the erasure request already sent.',
      note ? `\nNote from the data subject: ${note}` : '',
      '',
      'Kind regards,',
      name,
      `on behalf of the data subject, via ${ctx.operatorName}`,
      `Reference: ${ctx.shortRef}`,
    ].join('\n'),
  };
}

/** First-person text the user can copy into a web form or send from their own PEC. */
export function manualRequestText(ctx: RequestEmailContext): string {
  const name = fullName(ctx.pii);
  if (ctx.kind === 'access') {
    return [
      `Spett.le ${ctx.brokerName},`,
      '',
      `io sottoscritto/a ${name} esercito il diritto di accesso previsto dall'art. 15 del Regolamento (UE) 2016/679 (GDPR) e chiedo:`,
      '1. la conferma che sia in corso un trattamento di dati personali che mi riguardano;',
      "2. una copia dei dati trattati e le informazioni dell'art. 15, par. 1 (finalità, categorie di dati, destinatari, conservazione, origine dei dati, eventuale profilazione);",
      '3. un riscontro scritto entro un mese (art. 12, par. 3 GDPR), in formato elettronico di uso comune.',
      '',
      'Dati per identificarmi:',
      ...identifyingData(ctx.pii, 'it'),
      '',
      `Riferimento pratica: ${ctx.shortRef}`,
      '',
      'In mancanza di riscontro potrò proporre reclamo al Garante per la protezione dei dati personali (art. 77 GDPR).',
      '',
      'Cordiali saluti,',
      name,
    ].join('\n');
  }
  return [
    `Spett.le ${ctx.brokerName},`,
    '',
    `io sottoscritto/a ${name} esercito i diritti previsti dagli artt. 17 e 21 del Regolamento (UE) 2016/679 (GDPR) e chiedo:`,
    '1. la cancellazione senza ingiustificato ritardo di tutti i dati personali che mi riguardano;',
    '2. di cessare ogni trattamento dei miei dati per marketing diretto, profilazione, cessione a terzi, inserendomi in una lista di soppressione;',
    '3. la comunicazione della cancellazione ai destinatari ai quali i dati sono stati trasmessi (art. 19);',
    '4. un riscontro scritto entro un mese (art. 12, par. 3 GDPR).',
    '',
    'Dati per identificarmi:',
    ...identifyingData(ctx.pii, 'it'),
    '',
    `Riferimento pratica: ${ctx.shortRef}`,
    '',
    `In mancanza di riscontro potrò proporre reclamo al Garante per la protezione dei dati personali (art. 77 GDPR).`,
    '',
    'Cordiali saluti,',
    name,
  ].join('\n');
}

export interface ComplaintContext {
  pii: ProfilePii;
  brokerName: string;
  brokerWebsite?: string;
  shortRef: string;
  sentOn: string;
  dueOn: string;
  reminders: { on: string }[];
  operatorName: string;
  generatedOn: string;
}

/** Draft of the "reclamo" to the Italian DPA (art. 77 GDPR; artt. 140-bis ss. Codice privacy). */
export function complaintText(ctx: ComplaintContext): string {
  const name = fullName(ctx.pii);
  return [
    'Al Garante per la protezione dei dati personali',
    'Piazza Venezia n. 11 - 00187 Roma',
    '',
    'OGGETTO: Reclamo ai sensi dell\'art. 77 del Regolamento (UE) 2016/679 e degli artt. 140-bis e ss. del D.Lgs. 196/2003 - mancato riscontro a richiesta di cancellazione e opposizione (artt. 17 e 21 GDPR)',
    '',
    `Il/La sottoscritto/a ${name}, ${ctx.pii.dateOfBirth ? `nato/a il ${ctx.pii.dateOfBirth}, ` : ''}${ctx.pii.addresses[0] ? `residente in ${formatAddress(ctx.pii.addresses[0])}, ` : ''}email ${ctx.pii.emails[0] ?? '-'},`,
    '',
    'PREMESSO CHE',
    `- in data ${ctx.sentOn} ha esercitato, tramite ${ctx.operatorName} su delega scritta, i diritti di cancellazione e di opposizione nei confronti di ${ctx.brokerName}${ctx.brokerWebsite ? ` (${ctx.brokerWebsite})` : ''} (riferimento pratica ${ctx.shortRef});`,
    `- il termine di un mese previsto dall'art. 12, par. 3 GDPR è scaduto in data ${ctx.dueOn}${ctx.reminders.length ? `; sono stati inviati ${ctx.reminders.length} solleciti (${ctx.reminders.map((r) => r.on).join(', ')})` : ''};`,
    '- il titolare non ha fornito alcun riscontro idoneo e non ha dimostrato di aver cancellato i dati.',
    '',
    'CHIEDE',
    "che il Garante accerti la violazione degli artt. 12, 17 e 21 GDPR e adotti i provvedimenti di cui all'art. 58 GDPR, in particolare ordinando al titolare la cancellazione dei dati dell'interessato e la comunicazione ai destinatari, nonché ogni altra misura ritenuta opportuna.",
    '',
    'ALLEGA',
    '1. copia di un documento di identità;',
    "2. delega sottoscritta dall'interessato;",
    '3. copia della richiesta inviata e dei solleciti (con data e riferimento);',
    '4. eventuali risposte ricevute.',
    '',
    `Luogo e data: ____________________, ${ctx.generatedOn}`,
    `Firma: ____________________ (${name})`,
  ].join('\n');
}

export interface NuisanceEvent {
  at: string; // ISO
  channel: string;
  callerNumber: string | null;
  company: string | null;
  summary: string | null;
  consentGiven: 'no' | 'unknown';
  rpoActiveAtTime: boolean | null;
}

export interface NuisanceComplaintContext {
  pii: ProfilePii;
  events: NuisanceEvent[];
  rpoRegisteredOn: string | null;
  rpoEffectiveFrom: string | null;
  operatorName: string;
  generatedOn: string;
}

const CHANNEL_LABEL: Record<string, string> = { call: 'chiamata', sms: 'SMS', messaging: 'messaggio (app)', email: 'email', post: 'posta' };

/** Draft of the "segnalazione" to the Italian DPA about unsolicited commercial communications (art. 130 and 144 Codice privacy). */
export function nuisanceComplaintText(ctx: NuisanceComplaintContext): string {
  const name = fullName(ctx.pii);
  const withRpo = ctx.events.filter((e) => e.rpoActiveAtTime === true).length;
  return [
    'Al Garante per la protezione dei dati personali',
    'Piazza Venezia n. 11 - 00187 Roma',
    '',
    "OGGETTO: Segnalazione ai sensi dell'art. 144 del D.Lgs. 196/2003 - comunicazioni commerciali indesiderate (art. 130 D.Lgs. 196/2003; D.P.R. 178/2010)",
    '',
    `Il/La sottoscritto/a ${name}, email ${ctx.pii.emails[0] ?? '-'}${ctx.pii.phones[0] ? `, telefono ${ctx.pii.phones[0]}` : ''},`,
    '',
    'SEGNALA',
    `di aver ricevuto ${ctx.events.length} ${ctx.events.length === 1 ? 'comunicazione commerciale' : 'comunicazioni commerciali'} non richiest${ctx.events.length === 1 ? 'a' : 'e'}, senza aver mai prestato un consenso a tali contatti, come da elenco seguente:`,
    '',
    ...ctx.events.map(
      (e) =>
        `- ${e.at.slice(0, 16).replace('T', ' ')} (${CHANNEL_LABEL[e.channel] ?? e.channel}) da ${e.callerNumber ?? 'mittente non indicato'}${e.company ? ` per conto di ${e.company}` : ''}${e.summary ? `: ${e.summary}` : ''}${e.rpoActiveAtTime === true ? ' [iscrizione al RPO già efficace]' : ''}`,
    ),
    '',
    ctx.rpoRegisteredOn
      ? `Il sottoscritto è iscritto al Registro Pubblico delle Opposizioni dal ${ctx.rpoRegisteredOn} (efficace dal ${ctx.rpoEffectiveFrom ?? '-'}): ${withRpo} dei contatti elencati sono successivi all'efficacia dell'iscrizione.`
      : 'Il sottoscritto non risulta iscritto al Registro Pubblico delle Opposizioni al momento della segnalazione.',
    '',
    'CHIEDE',
    "che il Garante verifichi la liceità dei trattamenti, individui i titolari delle comunicazioni e adotti i provvedimenti previsti dalla normativa, in particolare ai sensi dell'art. 58 GDPR e dell'art. 130 del Codice in materia di protezione dei dati personali.",
    '',
    'ALLEGA',
    '1. copia del registro delle chiamate o dei messaggi ricevuti (schermate);',
    "2. ricevuta dell'iscrizione al Registro delle Opposizioni, se disponibile;",
    '3. copia di un documento di identità.',
    '',
    `Luogo e data: ____________________, ${ctx.generatedOn}`,
    `Firma: ____________________ (${name})`,
  ].join('\n');
}
