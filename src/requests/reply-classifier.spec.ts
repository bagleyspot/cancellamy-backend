import { classifyReply, indicatesNoData, stripQuoted } from './reply-classifier';

describe('classifyReply', () => {
  const cases: Array<[string, string, string]> = [
    ['completed (it)', 'Buongiorno, abbiamo provveduto alla cancellazione di tutti i suoi dati personali.', 'completed'],
    ['completed (it) participle', 'I suoi dati sono stati cancellati dai nostri archivi.', 'completed'],
    ['completed (en)', 'We have deleted your personal data from our systems.', 'completed'],
    ['completed (en) suppression', 'Your data has been erased and you were added to our suppression list.', 'completed'],
    ['refused legal obligation', 'Non è possibile cancellare i dati per obbligo di legge.', 'refused'],
    ['refused (en)', 'We are unable to delete your data due to a legal obligation.', 'refused'],
    ['refused no data held', 'We do not hold any data about you.', 'refused'],
    ['id required (it)', 'Per procedere ci invii una copia del documento di identità.', 'id_required'],
    ['id required (en)', 'Please verify your identity by sending a copy of your passport.', 'id_required'],
    ['auto reply ack', 'Abbiamo ricevuto la tua richiesta. Numero ticket 4821.', 'auto_reply'],
    ['out of office', 'I am out of office until Monday.', 'auto_reply'],
    ['more info', 'Potete fornire ulteriori informazioni per identificare il profilo?', 'more_info'],
    ['unknown', 'Ok, ne parliamo domani.', 'unknown'],
  ];
  it.each(cases)('%s', (_name, text, expected) => {
    expect(classifyReply('Re: richiesta', text)).toBe(expected);
  });

  it('does not treat negated deletion as completed', () => {
    expect(classifyReply('Re', 'Non abbiamo potuto cancellare i dati richiesti.')).toBe('refused');
  });

  it('ignores quoted history that repeats our own request', () => {
    const body = [
      'Ricevuto, ci stiamo lavorando.',
      '',
      'Il 12 ottobre 2026 alle 10:00 Cancellamy ha scritto:',
      '> Se ritenete indispensabile un documento di identità, indicatelo nella risposta.',
    ].join('\n');
    expect(classifyReply('Re: [CNC-AAAA2222]', body)).toBe('unknown');
  });

  it('stripQuoted removes > lines and the reply header block', () => {
    const out = stripQuoted('ciao\n> citazione\nOn Mon, 3 Oct 2026 at 10:00, X wrote:\nvecchio testo');
    expect(out).toBe('ciao');
  });
});

describe('access request replies', () => {
  it.each([
    ['In allegato trovate la copia dei suoi dati personali.', 'data_provided'],
    ['Please find attached a copy of your personal data.', 'data_provided'],
    ['We hold the following personal data about you: name, email.', 'data_provided'],
  ])('%s', (text, expected) => {
    expect(classifyReply('Re: richiesta di accesso', text)).toBe(expected);
  });

  it('detects "no data held" separately from a legal refusal', () => {
    expect(indicatesNoData('Re', 'We do not hold any personal data about you.')).toBe(true);
    expect(indicatesNoData('Re', 'Non trattiamo alcun dato che la riguardi.')).toBe(true);
    expect(indicatesNoData('Re', 'Non è possibile fornire i dati per obbligo di legge.')).toBe(false);
  });
});
