import { ProfilePii, fullName } from '../profiles/profile.types';
import type { EmailContent, RequestEmailContext } from './request-templates';

/**
 * First-person versions of the broker emails, used when the email is sent from the data subject's own mailbox:
 * the sender IS the data subject, so there is no mandate, no operator and no delega attached.
 */

type Identify = (pii: ProfilePii, lang: 'it' | 'en') => string[];

export function erasureEmailSelf(ctx: RequestEmailContext, identifyingData: Identify): EmailContent {
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
        `Io sottoscritto/a ${name}, in qualità di interessato, esercito personalmente i diritti previsti dal Regolamento (UE) 2016/679 ("GDPR") e dal D.Lgs. 196/2003 ("Codice Privacy", come modificato dal D.Lgs. 101/2018) e Vi scrivo da questo mio indirizzo email.`,
        '',
        renewal
          ? `NOTA: questa è una mia richiesta periodica di verifica e rinnovo (ciclo ${ctx.cycle}), perché i miei dati personali potrebbero essere stati acquisiti o indicizzati di nuovo dopo la mia precedente istanza${ctx.firstSentOn ? ` del ${ctx.firstSentOn}` : ''}.`
          : '',
        renewal ? '' : undefined,
        'Con la presente formulo istanza ai sensi degli artt. 7, par. 3, 17, 18, 19, 21 e 22 GDPR e chiedo:',
        '',
        '1. REVOCA DEL CONSENSO (art. 7, par. 3 GDPR): la revoca immediata di qualsiasi eventuale consenso da me prestato, direttamente o tramite soggetti terzi, per il trattamento o la comunicazione dei miei dati personali;',
        '2. OPPOSIZIONE AL TRATTAMENTO (art. 21, par. 1 e par. 2, e art. 22 GDPR): mi oppongo in modo immediato e assoluto a qualsiasi trattamento dei miei dati personali per finalità di marketing diretto, vendita o cessione a terzi, arricchimento di banche dati (data enrichment), profilazione, credit scoring non richiesto o processi decisionali automatizzati, nonché a qualsiasi trattamento fondato sul legittimo interesse Vostro o di terzi (art. 6, par. 1, lett. f GDPR);',
        '3. CANCELLAZIONE ("DIRITTO ALL\'OBLIO", art. 17, par. 1, lett. a, b, c, d GDPR): la cancellazione integrale e definitiva, senza ingiustificato ritardo, di tutti i miei dati personali presenti in qualsiasi archivio, banca dati, elenco, indice o servizio gestito dalla Vostra organizzazione. Se per impedire future riacquisizioni è strettamente necessario conservare una traccia, Vi chiedo di limitarvi a un identificativo crittografico non reversibile (hash) per quel solo scopo tecnico;',
        '4. NOTIFICA AI TERZI DESTINATARI (art. 19 GDPR): la comunicazione dell\'avvenuta cancellazione e della mia opposizione a ciascuno dei destinatari (clienti, partner commerciali, sub-fornitori o cessionari) cui i dati sono stati trasmessi e, se lo richiedo, l\'elenco di tali destinatari;',
        '5. ORIGINE DEI DATI (art. 14, par. 2, lett. f e art. 15, par. 1, lett. g GDPR): se avete trattato miei dati, l\'indicazione della fonte da cui li avete acquisiti;',
        '6. RISCONTRO ENTRO I TERMINI DI LEGGE (art. 12, par. 3 e par. 4 GDPR): un riscontro scritto entro un (1) mese dal ricevimento di questa email, che confermi quanto eseguito oppure attesti che non trattate alcun dato che mi riguarda.',
        '',
        'I miei dati identificativi (forniti solo per evadere questa istanza):',
        ...identifyingData(ctx.pii, 'it'),
        '',
        `Vi prego di rispondere direttamente a questa email, riportando nell'oggetto il codice di riferimento [${ctx.shortRef}].`,
        '',
        'AVVERTENZA SUI DOCUMENTI DI IDENTITÀ (art. 12, par. 6 e art. 5, par. 1, lett. c GDPR): in base al principio di minimizzazione e alle Linee Guida EDPB 01/2022, il titolare può chiedere copia di un documento di identità solo se ha dubbi ragionevoli e motivati sulla mia identità e non dispone di altri elementi per verificarla (come l\'indirizzo email o il numero di telefono qui indicati). Se lo ritenete strettamente indispensabile, motivatelo nella risposta e ve lo trasmetterò in modo sicuro.',
        '',
        'In mancanza di un riscontro tempestivo e idoneo entro il termine dell\'art. 12, par. 3 GDPR, o in caso di diniego non motivato, mi riservo di proporre reclamo al Garante per la protezione dei dati personali (art. 77 GDPR e artt. 140-bis e ss. D.Lgs. 196/2003) e di agire in sede giurisdizionale (artt. 79 e 82 GDPR).',
        '',
        'Distinti saluti,',
        name,
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
      `I, ${name}, am the data subject and I am exercising my rights under Regulation (EU) 2016/679 ("GDPR") myself. I am writing to you from my own email address.`,
      '',
      renewal
        ? `NOTE: this is my periodic verification and follow-up request (cycle ${ctx.cycle}), as my personal data may have been collected or indexed again after my previous request${ctx.firstSentOn ? ` of ${ctx.firstSentOn}` : ''}.`
        : '',
      renewal ? '' : undefined,
      'Pursuant to Articles 7(3), 17, 18, 19, 21 and 22 GDPR, I hereby request the following:',
      '',
      '1. WITHDRAWAL OF CONSENT (Art. 7(3) GDPR): the immediate withdrawal of any consent I may have given, whether directly or through third parties, for the processing or disclosure of my personal data;',
      '2. OBJECTION TO PROCESSING (Art. 21(1), Art. 21(2) and Art. 22 GDPR): I object, immediately and unconditionally, to any processing of my personal data for direct marketing, sale, licensing, disclosure to third parties, data enrichment, profiling or automated decision-making, as well as to any processing based on legitimate interests under Art. 6(1)(f) GDPR;',
      '3. ERASURE ("RIGHT TO BE FORGOTTEN", Art. 17(1)(a)-(d) GDPR): the complete and permanent erasure, without undue delay, of all my personal data held in any database, directory, index, product or service operated by your organisation. If keeping a suppression record is strictly necessary to prevent re-ingestion, please retain only a non-reversible cryptographic hash for that exclusive technical purpose;',
      '4. NOTIFICATION TO RECIPIENTS (Art. 19 GDPR): the notification of this erasure and of my objection to every recipient (clients, commercial partners, sub-processors or transferees) to whom my data have been disclosed and, if I ask, the list of those recipients;',
      '5. SOURCE OF DATA (Art. 14(2)(f) and Art. 15(1)(g) GDPR): if you have processed my data, the specific source from which they were obtained;',
      '6. STATUTORY RESPONSE (Art. 12(3) and Art. 12(4) GDPR): a written reply within one (1) month of receiving this email, confirming what has been done or confirming that you hold no personal data relating to me.',
      '',
      'Information to identify me (provided only to deal with this request):',
      ...identifyingData(ctx.pii, 'en'),
      '',
      `Please reply directly to this email, quoting the reference [${ctx.shortRef}] in the subject line.`,
      '',
      'NOTICE ON IDENTITY DOCUMENTS (Art. 12(6) and Art. 5(1)(c) GDPR): in line with data minimisation and EDPB Guidelines 01/2022, a controller may ask for a copy of an identity document only where it has reasonable and substantiated doubts about my identity and cannot verify it from the contact details given above. If you consider a document strictly necessary, please explain why in your reply and I will send it securely.',
      '',
      'Absent a timely and compliant reply within the deadline of Art. 12(3) GDPR, or in case of an unjustified refusal, I reserve the right to lodge a complaint with the competent Supervisory Authority (Art. 77 GDPR) and to seek a judicial remedy and compensation (Articles 79 and 82 GDPR).',
      '',
      'Kind regards,',
      name,
      `Reference: ${ctx.shortRef}`,
    ]
      .filter((l): l is string => l !== undefined)
      .join('\n'),
  };
}

export function accessEmailSelf(ctx: RequestEmailContext, identifyingData: Identify): EmailContent {
  const name = fullName(ctx.pii);
  if (ctx.lang === 'it') {
    return {
      subject: `Istanza di accesso ai dati personali (art. 15 GDPR) - ${name} [${ctx.shortRef}]`,
      text: [
        `Spett.le ${ctx.brokerName},`,
        'in persona del legale rappresentante pro tempore,',
        'e alla cortese attenzione del Responsabile della protezione dei dati (DPO / RPD) e dell’Ufficio Privacy',
        '',
        `Io sottoscritto/a ${name}, in qualità di interessato, esercito personalmente il diritto di accesso previsto dal Regolamento (UE) 2016/679 ("GDPR") e Vi scrivo da questo mio indirizzo email.`,
        '',
        'Ai sensi dell\'art. 15 GDPR chiedo:',
        '',
        '1. CONFERMA DEL TRATTAMENTO (art. 15, par. 1 GDPR): la conferma che sia o meno in corso un trattamento di dati personali che mi riguardano;',
        '2. COPIA DEI DATI (art. 15, par. 3 GDPR): in caso affermativo, una copia integrale e intelligibile di tutti i miei dati personali oggetto di trattamento, in formato elettronico strutturato e di uso comune;',
        '3. INFORMAZIONI OBBLIGATORIE (art. 15, par. 1, lett. a-h e par. 2 GDPR):',
        '   a) le finalità del trattamento e la relativa base giuridica;',
        '   b) le categorie di dati personali trattati;',
        '   c) i destinatari o le categorie di destinatari cui i dati sono stati o saranno comunicati (indicando l\'identità dei singoli destinatari, in linea con la sentenza CGUE C-154/21), in particolare se situati in paesi terzi, con le garanzie di cui all\'art. 46 GDPR;',
        '   d) il periodo di conservazione previsto o i criteri per determinarlo;',
        '   e) tutte le informazioni disponibili sull\'origine dei dati, se non sono stati raccolti presso di me;',
        '   f) l\'esistenza di un processo decisionale automatizzato, compresa la profilazione o lo scoring (art. 22, par. 1 e 4 GDPR), con informazioni significative sulla logica utilizzata, sull\'importanza e sulle conseguenze previste per me.',
        '4. RISCONTRO ENTRO I TERMINI DI LEGGE (art. 12, par. 3 GDPR): un riscontro scritto entro un (1) mese dal ricevimento di questa email.',
        '',
        'I miei dati identificativi (forniti solo per evadere questa istanza):',
        ...identifyingData(ctx.pii, 'it'),
        '',
        `Vi prego di rispondere a questa email citando il riferimento [${ctx.shortRef}].`,
        '',
        'AVVERTENZA SULLA MINIMIZZAZIONE (art. 12, par. 6 e art. 5, par. 1, lett. c GDPR): Vi chiedo di non subordinare il riscontro all\'invio di un documento di identità se i dati sopra indicati bastano a individuarmi nei Vostri archivi. Se avete dubbi ragionevoli e motivati sulla mia identità, specificatelo nella risposta: vi trasmetterò il documento in modo sicuro.',
        '',
        'In mancanza di riscontro nel termine di legge potrò proporre reclamo al Garante per la protezione dei dati personali (art. 77 GDPR e artt. 140-bis ss. D.Lgs. 196/2003) e agire in sede giurisdizionale (art. 79 GDPR).',
        '',
        'Distinti saluti,',
        name,
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
      `I, ${name}, am the data subject and I am exercising my right of access under Regulation (EU) 2016/679 ("GDPR") myself, writing from my own email address.`,
      '',
      'Pursuant to Article 15 GDPR, I request:',
      '',
      '1. CONFIRMATION OF PROCESSING (Art. 15(1) GDPR): confirmation as to whether or not personal data concerning me are being processed;',
      '2. COPY OF MY DATA (Art. 15(3) GDPR): where that is the case, a complete copy of all my personal data undergoing processing, in a commonly used electronic format;',
      '3. MANDATORY INFORMATION (Art. 15(1)(a)-(h) and Art. 15(2) GDPR):',
      '   a) the purposes of the processing and the applicable legal basis;',
      '   b) the categories of personal data concerned;',
      '   c) the specific recipients or categories of recipients to whom my data have been or will be disclosed (in line with CJEU Case C-154/21), including recipients in third countries and the safeguards under Art. 46 GDPR;',
      '   d) the envisaged retention period or the criteria used to determine it;',
      '   e) all available information on the source of the data where they were not collected from me;',
      '   f) the existence of automated decision-making, including profiling or scoring under Art. 22(1) and (4) GDPR, meaningful information about the logic involved, and the significance and envisaged consequences for me.',
      '4. STATUTORY RESPONSE (Art. 12(3) GDPR): a written reply within one (1) month of receiving this email.',
      '',
      'Information to identify me (provided only to deal with this request):',
      ...identifyingData(ctx.pii, 'en'),
      '',
      `Please reply to this email quoting the reference [${ctx.shortRef}].`,
      '',
      'NOTICE ON MINIMISATION (Art. 12(6) and Art. 5(1)(c) GDPR): please do not make your reply conditional on an identity document if the details above are enough to find me in your records. If you have reasonable and substantiated doubts about my identity, please say so in your reply and I will send the document securely.',
      '',
      'If I receive no reply within the statutory period I may lodge a complaint with the competent Supervisory Authority (Art. 77 GDPR) and seek a judicial remedy (Art. 79 GDPR).',
      '',
      'Kind regards,',
      name,
      `Reference: ${ctx.shortRef}`,
    ].join('\n'),
  };
}

export function reminderEmailSelf(ctx: RequestEmailContext & { reminderNumber: number }): EmailContent {
  const name = fullName(ctx.pii);
  const access = ctx.kind === 'access';
  if (ctx.lang === 'it') {
    return {
      subject: access
        ? `Sollecito n. ${ctx.reminderNumber} e diffida ad adempiere: richiesta di accesso (artt. 12 e 15 GDPR) - ${name} [${ctx.shortRef}]`
        : `Sollecito n. ${ctx.reminderNumber} e diffida ad adempiere: richiesta di cancellazione (artt. 12, 17 e 21 GDPR) - ${name} [${ctx.shortRef}]`,
      text: [
        `Spett.le ${ctx.brokerName},`,
        'alla cortese attenzione del Responsabile della protezione dei dati (DPO / RPD) e dell’Ufficio Privacy',
        '',
        access
          ? `faccio seguito alla mia istanza di accesso ai dati personali (art. 15 GDPR) inviata${ctx.firstSentOn ? ` il ${ctx.firstSentOn}` : ''} (riferimento pratica ${ctx.shortRef}).`
          : `faccio seguito alla mia istanza di cancellazione e opposizione al trattamento (artt. 17 e 21 GDPR) inviata${ctx.firstSentOn ? ` il ${ctx.firstSentOn}` : ''} (riferimento pratica ${ctx.shortRef}).`,
        `Il termine di un (1) mese previsto dall'art. 12, par. 3 GDPR${ctx.dueOn ? ` (scaduto il ${ctx.dueOn})` : ''} è decorso senza che io abbia ricevuto riscontro, né alcuna comunicazione motivata di proroga o di rifiuto ai sensi dell'art. 12, par. 3 e par. 4 GDPR.`,
        '',
        access
          ? "L'omesso riscontro nei termini di legge è una violazione degli artt. 12, par. 3 e 15 GDPR, sanzionabile ai sensi dell'art. 83, par. 5, lett. b) GDPR."
          : "L'omesso riscontro nei termini di legge e la prosecuzione del trattamento nonostante la mia opposizione sono una violazione degli artt. 12, par. 3, 17 e 21 GDPR, sanzionabile ai sensi dell'art. 83, par. 5, lett. b) GDPR.",
        '',
        access
          ? 'Vi invito e diffido a rispondere con urgenza a questa email, confermando il trattamento e inviandomi la copia dei dati richiesti. In mancanza di un riscontro immediato presenterò, senza ulteriore avviso, reclamo al Garante per la protezione dei dati personali (art. 77 GDPR e artt. 140-bis ss. D.Lgs. 196/2003).'
          : 'Vi invito e diffido a rispondere con urgenza a questa email, confermando la cancellazione integrale dei miei dati e la notifica ai destinatari (art. 19 GDPR), oppure indicando gli specifici motivi legittimi cogenti che la impediscono. In mancanza di un riscontro immediato presenterò, senza ulteriore avviso, reclamo al Garante per la protezione dei dati personali (art. 77 GDPR e artt. 140-bis ss. D.Lgs. 196/2003).',
        '',
        'Distinti saluti,',
        name,
        `Riferimento pratica: ${ctx.shortRef}`,
      ].join('\n'),
    };
  }
  return {
    subject: access
      ? `Reminder no. ${ctx.reminderNumber} - Formal notice of non-compliance: GDPR access request (Art. 12 and 15) - ${name} [${ctx.shortRef}]`
      : `Reminder no. ${ctx.reminderNumber} - Formal notice: GDPR erasure request (Art. 12, 17 and 21) - ${name} [${ctx.shortRef}]`,
    text: [
      `Dear ${ctx.brokerName},`,
      'For the attention of the Data Protection Officer (DPO) / Privacy and Legal Department',
      '',
      access
        ? `I refer to my data access request under Art. 15 GDPR sent${ctx.firstSentOn ? ` on ${ctx.firstSentOn}` : ''} (reference ${ctx.shortRef}).`
        : `I refer to my erasure and objection request sent${ctx.firstSentOn ? ` on ${ctx.firstSentOn}` : ''} (reference ${ctx.shortRef}).`,
      `The one-month deadline of Art. 12(3) GDPR${ctx.dueOn ? ` (expired on ${ctx.dueOn})` : ''} has elapsed and I have not received a reply, nor any reasoned notice of extension or refusal under Art. 12(3) and Art. 12(4) GDPR.`,
      '',
      access
        ? 'Failure to respond within the statutory period is an infringement of Articles 12(3) and 15 GDPR, subject to administrative fines under Art. 83(5)(b) GDPR.'
        : 'Failure to respond within the statutory period, and continued processing after my objection, are infringements of Articles 12(3), 17 and 21 GDPR, subject to administrative fines under Art. 83(5)(b) GDPR.',
      '',
      access
        ? 'Please reply urgently to this email, confirming the processing and sending me a copy of my data. Absent an immediate reply I will lodge a complaint with the competent Supervisory Authority (Art. 77 GDPR) without further notice.'
        : 'Please reply urgently to this email, confirming the erasure of my data and the notification to recipients (Art. 19 GDPR), or stating the specific legal grounds that prevent it. Absent an immediate reply I will lodge a complaint with the Supervisory Authority (Art. 77 GDPR) without further notice.',
      '',
      'Kind regards,',
      name,
      `Reference: ${ctx.shortRef}`,
    ].join('\n'),
  };
}

export function idProvidedEmailSelf(ctx: RequestEmailContext, note?: string): EmailContent {
  const name = fullName(ctx.pii);
  if (ctx.lang === 'it') {
    return {
      subject: `Trasmissione documento di identità per verifica (art. 12, par. 6 GDPR) - ${name} [${ctx.shortRef}]`,
      text: [
        `Spett.le ${ctx.brokerName},`,
        'alla cortese attenzione del Responsabile della protezione dei dati (DPO / RPD) e dell’Ufficio Privacy',
        '',
        `in riscontro alla Vostra richiesta di identificazione relativa alla pratica ${ctx.shortRef}, Vi trasmetto in allegato copia del mio documento di identità.`,
        '',
        'CONDIZIONI DI TRATTAMENTO DEL DOCUMENTO (art. 5, par. 1, lett. b, c, e ed art. 12, par. 6 GDPR):',
        '1. Il documento è fornito solo per verificare la mia identità in relazione alla mia istanza (limitazione della finalità);',
        '2. Vi è fatto espresso divieto di usare i dati del documento per arricchire i Vostri archivi, associarli a profili esistenti o comunicarli a terzi;',
        '3. In base alla limitazione della conservazione (art. 5, par. 1, lett. e GDPR), Vi diffido a cancellare e distruggere in modo sicuro la copia allegata subito dopo la verifica, confermandomelo nel riscontro finale alla mia istanza.',
        note ? `\nMia nota: ${note}` : '',
        '',
        'Attendo la conferma di evasione della richiesta principale nei termini di legge.',
        '',
        'Distinti saluti,',
        name,
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
      `in reply to your identification request regarding case ${ctx.shortRef}, please find attached a copy of my identity document.`,
      '',
      'CONDITIONS OF PROCESSING (Art. 5(1)(b), (c), (e) and Art. 12(6) GDPR):',
      '1. This document is sent only to verify my identity in connection with my request (purpose limitation);',
      '2. You must not use any data in this document to enrich your databases, link records, or disclose them to third parties;',
      '3. Under the storage limitation principle (Art. 5(1)(e) GDPR), please permanently delete and destroy the attached copy immediately after the identity check, and confirm its deletion in your final response to my request.',
      note ? `\nMy note: ${note}` : '',
      '',
      'I await your confirmation that my request has been fulfilled.',
      '',
      'Kind regards,',
      name,
      `Reference: ${ctx.shortRef}`,
    ].join('\n'),
  };
}
