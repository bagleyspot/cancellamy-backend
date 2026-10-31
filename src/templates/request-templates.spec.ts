import { accessEmail, complaintText, erasureEmail, idProvidedEmail, manualRequestText, reminderEmail } from './request-templates';

const pii = {
  firstName: 'Mario',
  lastName: 'Rossi',
  dateOfBirth: '1985-03-12',
  emails: ['mario@example.it'],
  phones: ['+39 333 1234567'],
  addresses: [{ street: 'Via Roma 1', city: 'Milano', zip: '20100', province: 'MI', country: 'IT' }],
  fiscalCode: 'RSSMRA85C12F205Z',
  aliases: ['Mario Rosi'],
};
const base = { brokerName: 'Acme', shortRef: 'CNC-ABCD2345', operatorName: 'Cancellamy', pii, cycle: 1 };

describe('request templates', () => {
  it('renders the Italian erasure email with the identifying data, legal articles and reference', () => {
    const e = erasureEmail({ ...base, lang: 'it' });
    expect(e.subject).toContain('[CNC-ABCD2345]');
    expect(e.subject).toContain('Mario Rossi');
    for (const needle of [
      'artt. 7, par. 3, 17, 18, 19, 21 e 22 GDPR',
      'art. 12, par. 6',
      'Linee Guida EDPB 01/2022',
      'mario@example.it',
      'RSSMRA85C12F205Z',
      'Via Roma 1',
      '1985-03-12',
      'Mario Rosi',
      'art. 77 GDPR',
    ]) {
      expect(e.text).toContain(needle);
    }
  });
  it('renders the English variant', () => {
    const e = erasureEmail({ ...base, lang: 'en' });
    expect(e.subject).toContain('GDPR erasure');
    expect(e.text).toContain('Articles 7(3), 17, 18, 19, 21 and 22 GDPR');
    expect(e.text).toContain('EDPB Guidelines 01/2022');
  });
  it('renders the access email citing CJEU C-154/21 and Art. 15', () => {
    const itAccess = accessEmail({ ...base, lang: 'it' });
    expect(itAccess.text).toContain('C-154/21');
    const enAccess = accessEmail({ ...base, lang: 'en' });
    expect(enAccess.text).toContain('C-154/21');
  });
  it('omits optional fields that are absent (data minimisation)', () => {
    const e = erasureEmail({ ...base, lang: 'it', pii: { ...pii, fiscalCode: undefined, dateOfBirth: undefined, aliases: [], phones: [] } });
    expect(e.text).not.toContain('Codice fiscale');
    expect(e.text).not.toContain('Data di nascita');
    expect(e.text).not.toContain('Telefono');
  });
  it('marks renewals', () => {
    expect(erasureEmail({ ...base, lang: 'it', cycle: 2, firstSentOn: '2026-01-01' }).text).toContain('richiesta periodica');
  });
  it('renders reminders, id emails, manual text and the complaint draft', () => {
    expect(reminderEmail({ ...base, lang: 'it', reminderNumber: 2, dueOn: '2026-02-01' }).subject).toContain('Sollecito n. 2');
    expect(reminderEmail({ ...base, lang: 'en', reminderNumber: 1 }).subject).toContain('Reminder no. 1');
    expect(idProvidedEmail({ ...base, lang: 'it' }, 'nota').text).toContain('nota');
    expect(manualRequestText({ ...base, lang: 'it' })).toContain('Io sottoscritto/a Mario Rossi');
    const c = complaintText({
      pii,
      brokerName: 'Acme',
      shortRef: 'CNC-ABCD2345',
      sentOn: '2026-01-01',
      dueOn: '2026-01-31',
      reminders: [{ on: '2026-02-01' }],
      operatorName: 'Cancellamy',
      generatedOn: '2026-03-01',
    });
    expect(c).toContain('Garante per la protezione dei dati personali');
    expect(c).toContain('2026-01-31');
    expect(c).toContain('sono stati inviati 1 solleciti');
  });
});

describe('request templates sent from the own mailbox (the user is the data subject)', () => {
  const self = { ...base, operatorName: 'Studio Operatore', self: true };
  const MANDATE = /\bmandato\b|per delega|delega scritta|in nome e per conto|per conto di|tramite Studio Operatore|on behalf of|via Studio Operatore|authori[sz]ation|l'Interessato/i;

  const all = (lang: 'it' | 'en') => [
    erasureEmail({ ...self, lang }),
    accessEmail({ ...self, lang, kind: 'access' }),
    reminderEmail({ ...self, lang, reminderNumber: 1, firstSentOn: '2026-01-01', dueOn: '2026-01-31' }),
    reminderEmail({ ...self, lang, kind: 'access', reminderNumber: 2, firstSentOn: '2026-01-01', dueOn: '2026-01-31' }),
    idProvidedEmail({ ...self, lang }, 'Documento in corso di validità'),
  ];

  it.each(['it', 'en'] as const)('never mentions a mandate, a delega, the operator or a third person (%s)', (lang) => {
    for (const e of all(lang)) {
      expect(`${e.subject}\n${e.text}`).not.toMatch(MANDATE);
      expect(e.text).not.toContain('Studio Operatore');
      expect(e.subject).toContain('Mario Rossi');
      expect(e.subject).toContain('[CNC-ABCD2345]');
    }
  });

  it('writes the erasure email in the first person and still carries the identifying data and the legal basis', () => {
    const it = erasureEmail({ ...self, lang: 'it' });
    expect(it.text).toContain('Io sottoscritto/a Mario Rossi, in qualità di interessato, esercito personalmente i diritti');
    expect(it.text).toContain('Vi scrivo da questo mio indirizzo email');
    expect(it.text).toContain('artt. 7, par. 3, 17, 18, 19, 21 e 22 GDPR');
    expect(it.text).toContain('mi oppongo in modo immediato e assoluto');
    for (const needle of ['mario@example.it', 'RSSMRA85C12F205Z', 'Via Roma 1', '1985-03-12', 'Mario Rosi', 'art. 12, par. 6', 'art. 77 GDPR']) expect(it.text).toContain(needle);
    expect(it.text.trimEnd().endsWith('Riferimento pratica: CNC-ABCD2345')).toBe(true);

    const en = erasureEmail({ ...self, lang: 'en' });
    expect(en.text).toContain('I, Mario Rossi, am the data subject and I am exercising my rights');
    expect(en.text).toContain('I object, immediately and unconditionally');
    expect(en.text.trimEnd().endsWith('Reference: CNC-ABCD2345')).toBe(true);
  });

  it('writes the access request, the reminders and the ID email in the first person', () => {
    expect(accessEmail({ ...self, lang: 'it', kind: 'access' }).text).toContain('esercito personalmente il diritto di accesso');
    expect(accessEmail({ ...self, lang: 'en', kind: 'access' }).text).toContain('I am exercising my right of access under Regulation (EU) 2016/679');
    const reminder = reminderEmail({ ...self, lang: 'it', reminderNumber: 1, firstSentOn: '2026-01-01', dueOn: '2026-01-31' });
    expect(reminder.text).toContain('faccio seguito alla mia istanza di cancellazione e opposizione al trattamento (artt. 17 e 21 GDPR) inviata il 2026-01-01');
    expect(reminder.text).toContain('(scaduto il 2026-01-31)');
    expect(reminder.text).toContain('presenterò, senza ulteriore avviso, reclamo al Garante');
    expect(reminderEmail({ ...self, lang: 'en', reminderNumber: 1 }).text).toContain('I refer to my erasure and objection request');
    const id = idProvidedEmail({ ...self, lang: 'it' }, 'Documento in corso di validità');
    expect(id.text).toContain('copia del mio documento di identità');
    expect(id.text).toContain('Mia nota: Documento in corso di validità');
  });

  it('keeps the renewal note, in the first person', () => {
    const e = erasureEmail({ ...self, lang: 'it', cycle: 2, firstSentOn: '2026-01-01' });
    expect(e.text).toContain('questa è una mia richiesta periodica di verifica e rinnovo (ciclo 2)');
    expect(e.text).toContain('dopo la mia precedente istanza del 2026-01-01');
  });

  it('without the flag the mandate wording is unchanged', () => {
    expect(erasureEmail({ ...base, lang: 'it' }).text).toContain('ha conferito formale mandato con rappresentanza a Cancellamy');
  });

  it('the complaint draft drops the mandate and the delega attachment, and renumbers the attachments', () => {
    const ctx = { pii, brokerName: 'Acme', shortRef: 'CNC-ABCD2345', sentOn: '2026-01-01', dueOn: '2026-01-31', reminders: [], operatorName: 'Studio Operatore', generatedOn: '2026-02-05' };
    const mine = complaintText({ ...ctx, self: true });
    expect(mine).toContain('ha formalmente esercitato personalmente i diritti');
    expect(mine).not.toMatch(/Studio Operatore|atto di delega|munito di regolare delega/);
    expect(mine).toContain('2. copia integrale della richiesta inviata');
    expect(mine).toContain('3. eventuali comunicazioni');
    const delegated = complaintText(ctx);
    expect(delegated).toContain('per il tramite di Studio Operatore munito di regolare delega');
    expect(delegated).toContain("2. atto di delega sottoscritto dall'interessato;");
    expect(delegated).toContain('3. copia integrale della richiesta inviata');
  });
});

