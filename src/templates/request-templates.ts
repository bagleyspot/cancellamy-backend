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
      subject: `Istanza di cancellazione dei dati personali e opposizione al trattamento (artt. 7, 17, 19, 21 e 22 GDPR) - ${name} [${ctx.shortRef}]`,
      text: [
        `Spett.le ${ctx.brokerName},`,
        'in persona del legale rappresentante pro tempore,',
        'e alla cortese attenzione del Responsabile della protezione dei dati (DPO / RPD) e dell’Ufficio Privacy',
        '',
        `Il/La sottoscritto/a ${name} (di seguito "l'Interessato") ha conferito formale mandato con rappresentanza a ${ctx.operatorName} per l'esercizio dei diritti previsti dal Regolamento (UE) 2016/679 ("GDPR") e dal D.Lgs. 196/2003 ("Codice Privacy", come modificato dal D.Lgs. 101/2018). L'atto di delega sottoscritto dall'Interessato è allegato alla presente comunicazione e ne costituisce parte integrante.`,
        '',
        renewal
          ? `NOTA: La presente costituisce una richiesta periodica di verifica e rinnovo (ciclo ${ctx.cycle}), in quanto i dati personali dell'Interessato potrebbero essere stati nuovamente acquisiti o indicizzati successivamente alla precedente istanza${ctx.firstSentOn ? ` del ${ctx.firstSentOn}` : ''}.`
          : '',
        renewal ? '' : undefined,
        'Con la presente, in nome e per conto dell\'Interessato, si formula formale istanza ai sensi degli artt. 7, par. 3, 17, 18, 19, 21 e 22 GDPR e si richiede quanto segue:',
        '',
        '1. REVOCA DEL CONSENSO (art. 7, par. 3 GDPR): la revoca immediata di qualsiasi eventuale consenso precedentemente acquisito, direttamente o tramite soggetti terzi, per il trattamento o la comunicazione dei dati personali dell\'Interessato;',
        '2. OPPOSIZIONE AL TRATTAMENTO (art. 21, par. 1 e par. 2, e art. 22 GDPR): l\'opposizione immediata e assoluta a qualsiasi trattamento dei dati personali per finalità di marketing diretto, vendita o cessione a terzi, arricchimento di banche dati (data enrichment), profilazione, credit scoring non richiesto o processi decisionali automatizzati, nonché a qualsiasi trattamento fondato sul legittimo interesse del titolare o di terzi (art. 6, par. 1, lett. f GDPR);',
        '3. CANCELLAZIONE ("DIRITTO ALL\'OBLIO", art. 17, par. 1, lett. a, b, c, d GDPR): la cancellazione integrale e definitiva, senza ingiustificato ritardo, di tutti i dati personali riferibili all\'Interessato presenti in qualsiasi archivio, banca dati, elenco, indice o servizio gestito dalla Vostra organizzazione. Ai fini del necessario bilanciamento per l\'inserimento in liste di soppressione (blacklisting), si chiede di limitare la conservazione a un identificativo crittografico non reversibile (hash) al solo ed esclusivo scopo tecnico di impedire future riacquisizioni dei dati;',
        '4. NOTIFICA AI TERZI DESTINATARI (art. 19 GDPR): la comunicazione dell\'avvenuta cancellazione e opposizione a ciascuno dei destinatari (clienti, partner commerciali, sub-fornitori o cessionari) cui i dati personali sono stati trasmessi, fornendo all\'Interessato l\'elenco di tali destinatari qualora richiesto;',
        '5. ORIGINE DEI DATI (art. 14, par. 2, lett. f e art. 15, par. 1, lett. g GDPR): qualora i dati siano stati oggetto di trattamento, l\'indicazione della fonte specifica da cui sono stati acquisiti;',
        '6. RISCONTRO ENTRO I TERMINI DI LEGGE (art. 12, par. 3 e par. 4 GDPR): la trasmissione di un riscontro scritto entro e non oltre un (1) mese dal ricevimento della presente, confermando l\'avvenuta esecuzione di quanto richiesto ovvero attestando formalmente che nessun dato riferibile all\'Interessato è presente nei Vostri sistemi.',
        '',
        'Dati identificativi dell\'Interessato (forniti esclusivamente ai fini dell\'evasione della presente istanza):',
        ...identifyingData(ctx.pii, 'it'),
        '',
        `Si prega di inviare il riscontro rispondendo direttamente a questo messaggio e riportando nell'oggetto il codice di riferimento [${ctx.shortRef}].`,
        '',
        'AVVERTENZA SULLA RICHIESTA DI DOCUMENTI DI IDENTITÀ (art. 12, par. 6 e art. 5, par. 1, lett. c GDPR): si rammenta che, in conformità al principio di minimizzazione dei dati e alle Linee Guida EDPB 01/2022 sull\'esercizio dei diritti, il titolare può richiedere copia di un documento di identità solo qualora nutra ragionevoli e motivati dubbi sull\'identità del richiedente e non disponga di altri elementi per identificarlo (quali l\'indirizzo email o il numero telefonico qui indicati). Qualora riteniate un documento strettamente indispensabile, Vi invitiamo a motivarlo nella risposta affinché possa essere trasmesso in modo sicuro.',
        '',
        'In difetto di tempestivo e idoneo riscontro entro il termine perentorio di cui all\'art. 12, par. 3 GDPR, ovvero in caso di diniego immotivato, l\'Interessato si riserva di proporre formale reclamo al Garante per la protezione dei dati personali ai sensi dell\'art. 77 GDPR e degli artt. 140-bis e ss. del D.Lgs. 196/2003, nonché di agire in sede giurisdizionale ai sensi degli artt. 79 e 82 GDPR.',
        '',
        'Distinti saluti,',
        name,
        `per delega e mandato, tramite ${ctx.operatorName}`,
        `Riferimento pratica: ${ctx.shortRef}`,
      ]
        .filter((l): l is string => l !== undefined)
        .join('\n'),
    };
  }
  return {
    subject: `GDPR erasure and objection request (Articles 7, 17, 19, 21 and 22 GDPR) - ${name} [${ctx.shortRef}]`,
    text: [
      `Dear ${ctx.brokerName},`,
      'For the attention of the Data Protection Officer (DPO) / Privacy and Legal Department',
      '',
      `${name} (the "Data Subject") has granted formal written authority to ${ctx.operatorName} to exercise on their behalf the data protection rights provided for by Regulation (EU) 2016/679 (General Data Protection Regulation, "GDPR"). The written authorisation signed by the Data Subject is attached to this email and forms an integral part hereof.`,
      '',
      renewal
        ? `NOTE: This is a periodic verification and follow-up request (cycle ${ctx.cycle}), as personal data relating to the Data Subject may have been collected or indexed again following the previous request${ctx.firstSentOn ? ` of ${ctx.firstSentOn}` : ''}.`
        : '',
      renewal ? '' : undefined,
      'Pursuant to Articles 7(3), 17, 18, 19, 21 and 22 GDPR, the Data Subject hereby formally requests and gives notice of the following:',
      '',
      '1. WITHDRAWAL OF CONSENT (Art. 7(3) GDPR): the immediate withdrawal of any consent previously obtained, whether directly or through third parties, for the processing or disclosure of the Data Subject\'s personal data;',
      '2. OBJECTION TO PROCESSING (Art. 21(1), Art. 21(2) and Art. 22 GDPR): an immediate and unconditional objection to any processing of their personal data for direct marketing, sale, licensing, disclosure to third parties, data enrichment, profiling or automated decision-making, as well as to any processing based on legitimate interests under Art. 6(1)(f) GDPR;',
      '3. ERASURE ("RIGHT TO BE FORGOTTEN", Art. 17(1)(a)-(d) GDPR): the complete and permanent erasure without undue delay of all personal data relating to the Data Subject across any database, directory, index, product or service operated by your organisation. Should a suppression record be strictly necessary to prevent re-ingestion, you are requested to retain solely a non-reversible cryptographic hash for that exclusive technical purpose;',
      '4. NOTIFICATION TO RECIPIENTS (Art. 19 GDPR): the notification of this erasure and objection to every recipient (clients, commercial partners, sub-processors or transferees) to whom the personal data have been disclosed;',
      '5. SOURCE OF DATA (Art. 14(2)(f) and Art. 15(1)(g) GDPR): where personal data have been processed, disclosure of the specific source from which the data originated;',
      '6. STATUTORY RESPONSE (Art. 12(3) and Art. 12(4) GDPR): a written reply within one (1) month of receipt of this request confirming the actions taken, or formally confirming that you hold and process no personal data relating to the Data Subject.',
      '',
      'Information to identify the Data Subject (provided strictly for the purpose of fulfilling this request):',
      ...identifyingData(ctx.pii, 'en'),
      '',
      `Please reply directly to this email quoting the reference [${ctx.shortRef}] in the subject line.`,
      '',
      'NOTICE ON IDENTITY DOCUMENTS (Art. 12(6) and Art. 5(1)(c) GDPR): in accordance with the data minimisation principle and EDPB Guidelines 01/2022, a controller may request a copy of an identity document only where it has reasonable and substantiated doubts concerning the identity of the natural person making the request and cannot verify their identity through the contact details already provided above. If you consider an identity document strictly necessary, please state the specific reasons in your reply and it will be transmitted securely.',
      '',
      'Absent a timely and compliant reply within the statutory deadline of Art. 12(3) GDPR, the Data Subject reserves the right to lodge a formal complaint with the competent Supervisory Authority (Art. 77 GDPR) and to seek a judicial remedy and compensation (Articles 79 and 82 GDPR).',
      '',
      'Kind regards,',
      name,
      `on behalf of the Data Subject, via ${ctx.operatorName}`,
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
      subject: `Istanza di accesso ai dati personali (art. 15 GDPR) - ${name} [${ctx.shortRef}]`,
      text: [
        `Spett.le ${ctx.brokerName},`,
        'in persona del legale rappresentante pro tempore,',
        'e alla cortese attenzione del Responsabile della protezione dei dati (DPO / RPD) e dell’Ufficio Privacy',
        '',
        `Il/La sottoscritto/a ${name} (di seguito "l'Interessato") ha conferito formale mandato con rappresentanza a ${ctx.operatorName} per l'esercizio dei diritti previsti dal Regolamento (UE) 2016/679 ("GDPR") e dal D.Lgs. 196/2003. L'atto di delega sottoscritto dall'Interessato è allegato alla presente email.`,
        '',
        'Con la presente, in nome e per conto dell\'Interessato, si formula formale istanza di accesso ai sensi dell\'art. 15 GDPR e si chiede:',
        '',
        '1. CONFERMA DEL TRATTAMENTO (art. 15, par. 1 GDPR): la conferma che sia o meno in corso un trattamento di dati personali che riguardano l\'Interessato;',
        '2. COPIA INTEGRALE DEI DATI (art. 15, par. 3 GDPR): in caso affermativo, la consegna di una copia integrale e intelligibile di tutti i dati personali oggetto di trattamento, in formato elettronico strutturato e di uso comune;',
        '3. INFORMAZIONI OBBLIGATORIE (art. 15, par. 1, lett. a-h e par. 2 GDPR):',
        '   a) le finalità del trattamento e la relativa base giuridica;',
        '   b) le categorie di dati personali trattati;',
        '   c) i destinatari o le categorie di destinatari a cui i dati personali sono stati o saranno comunicati (specificando l\'identità dei singoli destinatari in conformità alla sentenza CGUE C-154/21), in particolare se situati in paesi terzi, con indicazione delle garanzie di cui all\'art. 46 GDPR;',
        '   d) il periodo di conservazione previsto oppure i criteri utilizzati per determinarlo;',
        '   e) tutte le informazioni disponibili sull\'origine dei dati qualora non siano stati raccolti presso l\'Interessato (indicando i soggetti o le fonti pubbliche/private di provenienza);',
        '   f) l\'esistenza di un processo decisionale automatizzato, compresa la profilazione o lo scoring di cui all\'art. 22, par. 1 e 4 GDPR, informazioni significative sulla logica utilizzata, nonché l\'importanza e le conseguenze previste di tale trattamento per l\'Interessato.',
        '4. RISCONTRO ENTRO I TERMINI DI LEGGE (art. 12, par. 3 GDPR): un riscontro scritto entro e non oltre un (1) mese dal ricevimento della presente istanza.',
        '',
        'Dati identificativi dell\'Interessato (forniti esclusivamente ai fini dell\'evasione della presente istanza):',
        ...identifyingData(ctx.pii, 'it'),
        '',
        `Si prega di inviare il riscontro rispondendo a questa email e citando il riferimento [${ctx.shortRef}].`,
        '',
        'AVVERTENZA SULLA MINIMIZZAZIONE (art. 12, par. 6 e art. 5, par. 1, lett. c GDPR): si chiede di non subordinare il riscontro all\'invio di un documento di identità qualora i dati identificativi sopra riportati siano sufficienti a individuare l\'Interessato nei Vostri archivi. Qualora sussistano ragionevoli e motivati dubbi sull\'identità, Vi preghiamo di specificarlo nella risposta: il documento sarà trasmesso in modo sicuro.',
        '',
        'In mancanza di riscontro nel termine di legge, l\'Interessato potrà proporre reclamo al Garante per la protezione dei dati personali (art. 77 GDPR e artt. 140-bis ss. D.Lgs. 196/2003) e agire in sede giurisdizionale (art. 79 GDPR).',
        '',
        'Distinti saluti,',
        name,
        `per delega e mandato, tramite ${ctx.operatorName}`,
        `Riferimento pratica: ${ctx.shortRef}`,
      ].join('\n'),
    };
  }
  return {
    subject: `GDPR data access request (Art. 15 GDPR) - ${name} [${ctx.shortRef}]`,
    text: [
      `Dear ${ctx.brokerName},`,
      'For the attention of the Data Protection Officer (DPO) / Privacy and Legal Department',
      '',
      `${name} (the "Data Subject") has appointed ${ctx.operatorName} to exercise on their behalf the rights granted by Regulation (EU) 2016/679 ("GDPR"). The written authorisation signed by the Data Subject is attached to this email.`,
      '',
      'Pursuant to Article 15 GDPR, the Data Subject formally requests:',
      '',
      '1. CONFIRMATION OF PROCESSING (Art. 15(1) GDPR): confirmation as to whether or not personal data concerning them are being processed;',
      '2. COPY OF PERSONAL DATA (Art. 15(3) GDPR): where that is the case, a complete copy of all personal data undergoing processing, provided in a commonly used electronic format;',
      '3. MANDATORY INFORMATION (Art. 15(1)(a)-(h) and Art. 15(2) GDPR):',
      '   a) the purposes of the processing and the applicable legal basis;',
      '   b) the categories of personal data concerned;',
      '   c) the specific recipients or categories of recipients to whom the personal data have been or will be disclosed (in accordance with CJEU Case C-154/21), including recipients in third countries and the safeguards under Art. 46 GDPR;',
      '   d) the envisaged retention period or the criteria used to determine that period;',
      '   e) all available information as to the source of the data where they were not collected from the Data Subject;',
      '   f) the existence of automated decision-making, including profiling or scoring under Art. 22(1) and (4) GDPR, meaningful information about the logic involved, as well as the significance and the envisaged consequences of such processing.',
      '4. STATUTORY RESPONSE (Art. 12(3) GDPR): a written reply within one (1) month of receipt of this request.',
      '',
      'Information to identify the Data Subject (provided strictly for the purpose of fulfilling this request):',
      ...identifyingData(ctx.pii, 'en'),
      '',
      `Please reply directly to this email quoting the reference [${ctx.shortRef}].`,
      '',
      'NOTICE ON DATA MINIMISATION (Art. 12(6) and Art. 5(1)(c) GDPR): please do not request an identity document if the identifying details above are sufficient to locate the Data Subject\'s records. Should you have reasonable and substantiated doubts regarding identity, please state so in your reply and the document will be sent securely.',
      '',
      'If no reply is received within the statutory deadline, the Data Subject may lodge a complaint with the competent Supervisory Authority (Art. 77 GDPR) and seek a judicial remedy (Art. 79 GDPR).',
      '',
      'Kind regards,',
      name,
      `on behalf of the Data Subject, via ${ctx.operatorName}`,
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
          subject: `Sollecito n. ${ctx.reminderNumber} e diffida ad adempiere: richiesta di accesso (artt. 12 e 15 GDPR) - ${name} [${ctx.shortRef}]`,
          text: [
            `Spett.le ${ctx.brokerName},`,
            'alla cortese attenzione del Responsabile della protezione dei dati (DPO / RPD) e dell’Ufficio Privacy',
            '',
            `facciamo seguito alla formale istanza di accesso ai dati personali (art. 15 GDPR) trasmessa${ctx.firstSentOn ? ` in data ${ctx.firstSentOn}` : ''} (riferimento pratica ${ctx.shortRef}) in nome e per conto di ${name}, corredata da regolare delega scritta.`,
            `Rileviamo che il termine perentorio di un (1) mese previsto dall'art. 12, par. 3 GDPR${ctx.dueOn ? ` (scaduto il ${ctx.dueOn})` : ''} è integralmente decorso senza che sia pervenuto alcun riscontro, né alcuna comunicazione motivata di proroga ai sensi dell'art. 12, par. 3, secondo periodo, o di diniego ai sensi dell'art. 12, par. 4 GDPR.`,
            '',
            "L'omesso riscontro nei termini di legge configura un'autonoma violazione dell'art. 12, par. 3 e dell'art. 15 GDPR, sanzionabile ai sensi dell'art. 83, par. 5, lett. b) GDPR.",
            '',
            "Con la presente Vi invitiamo e diffidiamo a fornire riscontro scritto con la massima urgenza, trasmettendo la conferma del trattamento e la copia dei dati richiesti. In difetto di riscontro immediato, l'Interessato procederà senza ulteriore avviso alla presentazione di formale reclamo al Garante per la protezione dei dati personali (art. 77 GDPR e artt. 140-bis ss. D.Lgs. 196/2003).",
            '',
            'Distinti saluti,',
            name,
            `per delega e mandato, tramite ${ctx.operatorName}`,
            `Riferimento pratica: ${ctx.shortRef}`,
          ].join('\n'),
        }
      : {
          subject: `Reminder no. ${ctx.reminderNumber} - Formal notice of non-compliance: GDPR access request (Art. 12 and 15) - ${name} [${ctx.shortRef}]`,
          text: [
            `Dear ${ctx.brokerName},`,
            'For the attention of the Data Protection Officer (DPO) / Privacy and Legal Department',
            '',
            `we refer to the formal data access request under Art. 15 GDPR sent${ctx.firstSentOn ? ` on ${ctx.firstSentOn}` : ''} (reference ${ctx.shortRef}) on behalf of ${name}.`,
            `The statutory one-month deadline under Art. 12(3) GDPR${ctx.dueOn ? ` (expired on ${ctx.dueOn})` : ''} has elapsed without a reply, nor have you provided any reasoned notice of extension under Art. 12(3) or refusal under Art. 12(4) GDPR.`,
            '',
            'Failure to respond within the statutory timeframe constitutes an infringement of Articles 12(3) and 15 GDPR, subject to administrative fines under Art. 83(5)(b) GDPR.',
            '',
            'Please reply urgently with the confirmation of processing and a copy of the personal data. Absent an immediate reply, the Data Subject will proceed without further notice to lodge a formal complaint with the competent Supervisory Authority (Art. 77 GDPR).',
            '',
            'Kind regards,',
            name,
            `on behalf of the Data Subject, via ${ctx.operatorName}`,
            `Reference: ${ctx.shortRef}`,
          ].join('\n'),
        };
  }
  if (ctx.lang === 'it') {
    return {
      subject: `Sollecito n. ${ctx.reminderNumber} e diffida ad adempiere: richiesta di cancellazione (artt. 12, 17 e 21 GDPR) - ${name} [${ctx.shortRef}]`,
      text: [
        `Spett.le ${ctx.brokerName},`,
        'alla cortese attenzione del Responsabile della protezione dei dati (DPO / RPD) e dell’Ufficio Privacy',
        '',
        `facciamo seguito alla formale istanza di cancellazione e opposizione al trattamento (artt. 17 e 21 GDPR) inviata${ctx.firstSentOn ? ` il ${ctx.firstSentOn}` : ''} (riferimento ${ctx.shortRef}) in nome e per conto di ${name}, corredata da regolare delega scritta.`,
        `Il termine perentorio di un (1) mese previsto dall'art. 12, par. 3 GDPR${ctx.dueOn ? ` (scaduto il ${ctx.dueOn})` : ''} risulta integralmente decorso senza che abbiamo ricevuto riscontro, né alcuna comunicazione motivata di proroga o di rifiuto ai sensi dell'art. 12, par. 3 e par. 4 GDPR.`,
        '',
        "Si rammenta che il mancato riscontro nei termini di legge e la prosecuzione del trattamento in presenza di opposizione integrano una violazione degli artt. 12, par. 3, 17 e 21 GDPR, sanzionabile ai sensi dell'art. 83, par. 5, lett. b) GDPR.",
        '',
        'Vi invitiamo e diffidiamo pertanto a rispondere con urgenza a questa email confermando l\'avvenuta cancellazione integrale dei dati e la notifica ai destinatari (art. 19 GDPR), ovvero indicando gli specifici motivi legittimi cogenti che la impediscono. In mancanza di riscontro immediato, l’Interessato procederà senza ulteriore preavviso a depositare formale reclamo avanti al Garante per la protezione dei dati personali (art. 77 GDPR e artt. 140-bis ss. D.Lgs. 196/2003).',
        '',
        'Distinti saluti,',
        name,
        `per delega e mandato, tramite ${ctx.operatorName}`,
        `Riferimento pratica: ${ctx.shortRef}`,
      ].join('\n'),
    };
  }
  return {
    subject: `Reminder no. ${ctx.reminderNumber} - Formal notice: GDPR erasure request (Art. 12, 17 and 21) - ${name} [${ctx.shortRef}]`,
    text: [
      `Dear ${ctx.brokerName},`,
      'For the attention of the Data Protection Officer (DPO) / Privacy and Legal Department',
      '',
      `we refer to the formal erasure and objection request sent${ctx.firstSentOn ? ` on ${ctx.firstSentOn}` : ''} (reference ${ctx.shortRef}) on behalf of ${name}.`,
      `The one-month deadline of Art. 12(3) GDPR${ctx.dueOn ? ` (expired on ${ctx.dueOn})` : ''} has elapsed and we have not received a reply, nor any reasoned notice of extension or refusal under Art. 12(3) and Art. 12(4) GDPR.`,
      '',
      'Failure to respond within the statutory period and continued processing following an objection constitute infringements of Articles 12(3), 17 and 21 GDPR, subject to administrative fines under Art. 83(5)(b) GDPR.',
      '',
      'Please reply urgently to this email, confirming the erasure of the data and notification to recipients (Art. 19 GDPR), or stating the specific legal grounds that prevent it. Absent an immediate reply, the Data Subject will proceed without further notice to lodge a formal complaint with the Supervisory Authority (Art. 77 GDPR).',
      '',
      'Kind regards,',
      name,
      `on behalf of the Data Subject, via ${ctx.operatorName}`,
      `Reference: ${ctx.shortRef}`,
    ].join('\n'),
  };
}

export function idProvidedEmail(ctx: RequestEmailContext, note?: string): EmailContent {
  const name = fullName(ctx.pii);
  if (ctx.lang === 'it') {
    return {
      subject: `Trasmissione documento di identità per verifica (art. 12, par. 6 GDPR) - ${name} [${ctx.shortRef}]`,
      text: [
        `Spett.le ${ctx.brokerName},`,
        'alla cortese attenzione del Responsabile della protezione dei dati (DPO / RPD) e dell’Ufficio Privacy',
        '',
        `in riscontro alla Vostra richiesta di identificazione relativa alla pratica ${ctx.shortRef}, si trasmette in allegato copia del documento di identità di ${name}.`,
        '',
        'CONDIZIONI DI TRATTAMENTO DEL DOCUMENTO (art. 5, par. 1, lett. b, c, e ed art. 12, par. 6 GDPR):',
        '1. Il documento è fornito al solo ed esclusivo fine puntuale di verificare l\'identità dell\'Interessato in relazione all\'istanza in oggetto (limitazione della finalità);',
        '2. È fatto espresso divieto di utilizzare i dati contenuti nel documento per arricchire i Vostri archivi, associarli a profili esistenti o comunicarli a terzi;',
        '3. Ai sensi del principio di limitazione della conservazione (art. 5, par. 1, lett. e GDPR), Vi diffidiamo a cancellare e distruggere in modo sicuro la copia del documento allegato immediatamente dopo aver completato la verifica dell\'identità, dandocene espressa conferma nel riscontro finale all\'istanza.',
        note ? `\nNota dell'Interessato: ${note}` : '',
        '',
        'Si resta in attesa della conferma di evasione della richiesta principale nei termini di legge.',
        '',
        'Distinti saluti,',
        name,
        `per delega e mandato, tramite ${ctx.operatorName}`,
        `Riferimento pratica: ${ctx.shortRef}`,
      ].join('\n'),
    };
  }
  return {
    subject: `Identity document for verification (Art. 12(6) GDPR) - ${name} [${ctx.shortRef}]`,
    text: [
      `Dear ${ctx.brokerName},`,
      'For the attention of the Data Protection Officer (DPO) / Privacy and Legal Department',
      '',
      `in reply to your identification request regarding case ${ctx.shortRef}, please find attached a copy of the identity document of ${name}.`,
      '',
      'CONDITIONS OF PROCESSING (Art. 5(1)(b), (c), (e) and Art. 12(6) GDPR):',
      '1. This document is transmitted for the sole and exclusive purpose of verifying the identity of the Data Subject in connection with the pending GDPR request (purpose limitation);',
      '2. You are strictly prohibited from using any data contained in this document to enrich your databases, link records, or disclose them to third parties;',
      '3. Pursuant to the storage limitation principle (Art. 5(1)(e) GDPR), you are required to permanently delete and destroy the attached document immediately upon completing the identity check, and to confirm its deletion in your final response.',
      note ? `\nNote from the Data Subject: ${note}` : '',
      '',
      'We await your confirmation that the underlying GDPR request has been fulfilled.',
      '',
      'Kind regards,',
      name,
      `on behalf of the Data Subject, via ${ctx.operatorName}`,
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
      'Alla cortese attenzione del Responsabile della protezione dei dati (DPO / RPD) e dell’Ufficio Privacy',
      '',
      `Io sottoscritto/a ${name}, in qualità di interessato, esercito formalmente il diritto di accesso previsto dall'art. 15 del Regolamento (UE) 2016/679 (GDPR) e chiedo:`,
      '1. la conferma che sia o meno in corso un trattamento di dati personali che mi riguardano;',
      '2. in caso affermativo, una copia integrale dei dati personali oggetto di trattamento in formato elettronico strutturato e di uso comune (art. 15, par. 3 GDPR);',
      '3. tutte le informazioni di cui all\'art. 15, par. 1 e par. 2 GDPR: finalità e base giuridica, categorie di dati, identità dei destinatari (sentenza CGUE C-154/21), periodo di conservazione, origine specifica dei dati se raccolti presso terzi o fonti pubbliche (art. 15, par. 1, lett. g), ed esistenza di profilazione o processi decisionali automatizzati (art. 22 GDPR);',
      '4. un riscontro scritto entro il termine perentorio di un (1) mese dal ricevimento della presente (art. 12, par. 3 GDPR).',
      '',
      'Dati identificativi (forniti al solo scopo di evadere la presente istanza):',
      ...identifyingData(ctx.pii, 'it'),
      '',
      `Riferimento pratica: ${ctx.shortRef}`,
      '',
      'In mancanza di tempestivo riscontro nel termine di legge, mi riservo di proporre reclamo al Garante per la protezione dei dati personali (art. 77 GDPR e artt. 140-bis ss. D.Lgs. 196/2003) e di agire in sede giurisdizionale.',
      '',
      'Distinti saluti,',
      name,
    ].join('\n');
  }
  return [
    `Spett.le ${ctx.brokerName},`,
    'Alla cortese attenzione del Responsabile della protezione dei dati (DPO / RPD) e dell’Ufficio Privacy',
    '',
    `Io sottoscritto/a ${name}, in qualità di interessato, esercito formalmente i diritti previsti dagli artt. 7, 17, 19, 21 e 22 del Regolamento (UE) 2016/679 (GDPR) e chiedo:`,
    '1. la revoca immediata di qualsiasi eventuale consenso al trattamento precedentemente prestato (art. 7, par. 3 GDPR);',
    '2. l\'opposizione immediata a qualsiasi trattamento dei miei dati personali per finalità di marketing diretto, cessione o comunicazione a terzi, arricchimento dati, profilazione o scoring (art. 21, par. 1 e par. 2, e art. 22 GDPR);',
    '3. la cancellazione integrale e definitiva, senza ingiustificato ritardo, di tutti i dati personali che mi riguardano presenti nelle Vostre banche dati (art. 17, par. 1 GDPR), mantenendo eventualmente il solo hash crittografico non reversibile in lista di soppressione al fine di impedire future riacquisizioni;',
    '4. la notifica dell\'avvenuta cancellazione e opposizione a tutti i destinatari ai quali i dati sono stati trasmessi (art. 19 GDPR) e l\'indicazione della fonte da cui avete acquisito i dati (art. 14, par. 2, lett. f GDPR);',
    '5. un riscontro scritto entro il termine perentorio di un (1) mese dal ricevimento della presente (art. 12, par. 3 GDPR).',
    '',
    'Dati identificativi (forniti al solo scopo di evadere la presente istanza):',
    ...identifyingData(ctx.pii, 'it'),
    '',
    `Riferimento pratica: ${ctx.shortRef}`,
    '',
    'In mancanza di tempestivo riscontro nel termine di legge, mi riservo di proporre reclamo al Garante per la protezione dei dati personali (art. 77 GDPR e artt. 140-bis ss. D.Lgs. 196/2003) e di agire in sede giurisdizionale.',
    '',
    'Distinti saluti,',
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
    'PEC: protocollo@pec.gpdp.it',
    '',
    "OGGETTO: Atto di reclamo ai sensi dell'art. 77 del Regolamento (UE) 2016/679 (GDPR) e degli artt. 140-bis e ss. del D.Lgs. 196/2003 - Omesso riscontro a istanza di esercizio dei diritti (artt. 12, 17, 19 e 21 GDPR)",
    '',
    `Il/La sottoscritto/a ${name}, ${ctx.pii.dateOfBirth ? `nato/a il ${ctx.pii.dateOfBirth}, ` : ''}${ctx.pii.fiscalCode ? `C.F. ${ctx.pii.fiscalCode}, ` : ''}${ctx.pii.addresses[0] ? `residente in ${formatAddress(ctx.pii.addresses[0])}, ` : ''}indirizzo email ${ctx.pii.emails[0] ?? '-'},`,
    '',
    'ESPONE E PREMETTE CHE',
    `- in data ${ctx.sentOn} il/la reclamante ha formalmente esercitato, per il tramite di ${ctx.operatorName} munito di regolare delega scritta allegata all'istanza, i diritti di revoca del consenso, cancellazione dei dati personali ("diritto all'oblio") e opposizione al trattamento (artt. 7, 17, 19 e 21 GDPR) nei confronti del titolare del trattamento ${ctx.brokerName}${ctx.brokerWebsite ? ` (sito web: ${ctx.brokerWebsite})` : ''} (riferimento pratica ${ctx.shortRef});`,
    `- il termine perentorio di un (1) mese previsto dall'art. 12, par. 3 GDPR per fornire riscontro è scaduto in data ${ctx.dueOn}${ctx.reminders.length ? `; sono stati inviati ${ctx.reminders.length} solleciti (${ctx.reminders.map((r) => r.on).join(', ')})` : ''};`,
    "- alla data odierna il titolare del trattamento non ha fornito alcun riscontro idoneo, non ha comunicato motivi di proroga o di rifiuto ai sensi dell'art. 12, par. 3 e 4 GDPR e non ha dimostrato di aver provveduto alla cancellazione dei dati e alla notifica ai destinatari.",
    '',
    'CONSIDERATO CHE',
    "- la condotta sopra descritta configura una palese violazione degli artt. 12, par. 3 e 4, 17, 19 e 21 del Regolamento (UE) 2016/679;",
    '',
    'TUTTO CIÒ PREMESSO, CHIEDE',
    "che codesto Ecc.mo Garante per la protezione dei dati personali, ai sensi dell'art. 58, par. 2 GDPR e dell'art. 143 del D.Lgs. 196/2003, voglia:",
    "1. accertare l'illiceità della condotta omissiva posta in essere da " + ctx.brokerName + " e la violazione degli artt. 12, 17, 19 e 21 GDPR;",
    "2. ingiungere al titolare del trattamento di soddisfare senza ulteriore ritardo le richieste dell'interessato, disponendo la cancellazione integrale dei dati personali, il divieto di ulteriore trattamento e la comunicazione ai terzi destinatari (art. 58, par. 2, lett. c, f, g GDPR);",
    "3. adottare ogni ulteriore provvedimento correttivo e sanzionatorio ritenuto opportuno ai sensi degli artt. 58, par. 2, lett. i) e 83, par. 5, lett. b) GDPR.",
    '',
    'SI ALLEGANO:',
    "1. copia del documento di identità del reclamante in corso di validità;",
    "2. atto di delega sottoscritto dall'interessato;",
    '3. copia integrale della richiesta inviata e dei successivi solleciti (completi di data, intestazioni e codice di riferimento);',
    '4. eventuali comunicazioni o riscontri parziali ricevuti dal titolare.',
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
    'PEC: protocollo@pec.gpdp.it',
    '',
    "OGGETTO: Segnalazione formale ai sensi dell'art. 144 del D.Lgs. 196/2003 - Comunicazioni commerciali indesiderate (telemarketing / spam) in violazione dell'art. 130 del D.Lgs. 196/2003, della Legge n. 5/2018 e del D.P.R. 178/2010",
    '',
    `Il/La sottoscritto/a ${name}, ${ctx.pii.fiscalCode ? `C.F. ${ctx.pii.fiscalCode}, ` : ''}email ${ctx.pii.emails[0] ?? '-'}${ctx.pii.phones[0] ? `, utenza telefonica ${ctx.pii.phones[0]}` : ''},`,
    '',
    'ESPONE E SEGNALA',
    `di aver ricevuto ${ctx.events.length} ${ctx.events.length === 1 ? 'comunicazione promozionale/commerciale' : 'comunicazioni promozionali/commerciali'} non richiest${ctx.events.length === 1 ? 'a' : 'e'}, in totale assenza di un consenso libero, specifico, informato e documentato ai sensi degli artt. 6, par. 1, lett. a) e 7 GDPR e dell'art. 130 del D.Lgs. 196/2003, come dettagliato nel seguente prospetto cronologico:`,
    '',
    ...ctx.events.map(
      (e) =>
        `- ${e.at.slice(0, 16).replace('T', ' ')} (${CHANNEL_LABEL[e.channel] ?? e.channel}) da ${e.callerNumber ?? 'mittente non indicato'}${e.company ? ` per conto di ${e.company}` : ''}${e.summary ? `: ${e.summary}` : ''}${e.rpoActiveAtTime === true ? ' [iscrizione al RPO già efficace]' : ''}`,
    ),
    '',
    ctx.rpoRegisteredOn
      ? `Il/La segnalante precisa di essere regolarmente iscritto/a al Registro Pubblico delle Opposizioni (RPO) dal ${ctx.rpoRegisteredOn} (con efficacia dal ${ctx.rpoEffectiveFrom ?? '-'}), con conseguente revoca di diritto di tutti i consensi precedentemente espressi e divieto assoluto di contatto ai sensi della Legge n. 5/2018 e del D.P.R. 26/2022: ${withRpo} dei contatti sopra elencati sono avvenuti successivamente all'efficacia dell'iscrizione.`
      : 'Il/La segnalante precisa di non aver mai prestato consenso alla ricezione delle suddette comunicazioni commerciali.',
    '',
    'CHIEDE',
    "che codesto Ecc.mo Garante voglia accertare l'illiceità dei trattamenti segnalati, individuare i titolari e l'intera filiera dei committenti, call center e list provider coinvolti (anche in relazione all'eventuale violazione del Codice di Condotta per le attività di telemarketing e teleselling), e adottare i provvedimenti inibitori e sanzionatori previsti dagli artt. 58 e 83 GDPR e dall'art. 130 del Codice in materia di protezione dei dati personali.",
    '',
    'ALLEGA',
    '1. documentazione attestante le chiamate o i messaggi ricevuti (registro chiamate / schermate);',
    "2. attestazione di iscrizione al Registro Pubblico delle Opposizioni, ove applicabile;",
    '3. copia di un documento di identità in corso di validità.',
    '',
    `Luogo e data: ____________________, ${ctx.generatedOn}`,
    `Firma: ____________________ (${name})`,
  ].join('\n');
}
