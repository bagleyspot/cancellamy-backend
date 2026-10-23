import { complaintText, erasureEmail, idProvidedEmail, manualRequestText, reminderEmail } from './request-templates';

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
  it('renders the Italian erasure email with the identifying data and reference', () => {
    const e = erasureEmail({ ...base, lang: 'it' });
    expect(e.subject).toContain('[CNC-ABCD2345]');
    expect(e.subject).toContain('Mario Rossi');
    for (const needle of ['artt. 17 e 21', 'mario@example.it', 'RSSMRA85C12F205Z', 'Via Roma 1', '1985-03-12', 'Mario Rosi', 'art. 77']) {
      expect(e.text).toContain(needle);
    }
  });
  it('renders the English variant', () => {
    const e = erasureEmail({ ...base, lang: 'en' });
    expect(e.subject).toContain('GDPR erasure');
    expect(e.text).toContain('Articles 17 and 21');
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
    expect(manualRequestText({ ...base, lang: 'it' })).toContain('io sottoscritto/a Mario Rossi');
    const c = complaintText({ pii, brokerName: 'Acme', shortRef: 'CNC-ABCD2345', sentOn: '2026-01-01', dueOn: '2026-01-31', reminders: [{ on: '2026-02-01' }], operatorName: 'Cancellamy', generatedOn: '2026-03-01' });
    expect(c).toContain('Garante per la protezione dei dati personali');
    expect(c).toContain('2026-01-31');
    expect(c).toContain('sono stati inviati 1 solleciti');
  });
});
