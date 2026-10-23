export type ReplyLabel = 'completed' | 'refused' | 'id_required' | 'more_info' | 'auto_reply' | 'data_provided' | 'unknown';

const AUTO_REPLY = [
  /out of (the )?office/,
  /fuori (sede|ufficio)/,
  /risposta automatica/,
  /auto(matic)?[- ]?reply/,
  /do not reply to this (e-?mail|message)/,
  /non rispondere a questa (e-?mail|messaggio)/,
  /abbiamo ricevuto (la tua|la sua|la vostra) (richiesta|segnalazione|e-?mail)/,
  /we have received your (request|message|e-?mail)/,
  /your (request|ticket) (has been|was) (received|created|logged)/,
  /ticket (number|n\.?|#)/,
  /thank you for contacting/,
  /grazie per (averci )?contattat/,
];

const ID_REQUIRED = [
  /(copia|scansione|fotocopia) (di un |del |di )?(documento|carta d.identit|passaporto)/,
  /documento (di identit|d.identit)/,
  /carta d.identit/,
  /(proof|copy|scan) of (your )?(id|identity|identification|passport)/,
  /(verify|confirm) your identity/,
  /identity (verification|document)/,
  /valid (id|identification|photo id)/,
  /verificare (la tua|la sua) identit/,
  /verifica (della )?(tua|sua)? ?identit/,
];

const REFUSED = [
  /non (siamo|e' possibile|è possibile|possiamo|ci è possibile|risulta possibile|abbiamo potuto|ho potuto|è stato possibile|e' stato possibile)/,
  /impossibil/,
  /obbligo di legge/,
  /obblighi (di legge|legali)/,
  /legittimo interesse/,
  /(unable|not able|cannot|can't|can not) (to )?(delete|erase|remove|comply|process)/,
  /legal obligation/,
  /legitimate interest/,
  /(request|erasure) (is|has been) (denied|rejected|refused)/,
  /respinta?/,
  /rifiut/,
  /we (do not|don't) (hold|process|have) (any )?(data|information|personal)/,
  /(non|no) (trattiamo|abbiamo|deteniamo|risultano|risulta) (alcun )?(dat|record|informazion)/,
  /no (record|data|information) (found|was found|about you)/,
];

const COMPLETED = [
  /(provveduto|proceduto) (a|alla|all'|al) ?(cancellazion|eliminazion|rimozion|cancellar|eliminar|rimuover)/,
  /(abbiamo|è stata|e' stata|sono stati|sono state|risultano) (provveduto|proceduto)? ?(a )?(cancellat|eliminat|rimoss)/,
  /(cancellat|eliminat|rimoss)[aeio] (i|le|la|il|tutti|tutte)? ?(suoi |tuoi |vostri )?(dati|informazioni|profilo|record)/,
  /dati (sono stati |sono |risultano )?(cancellat|eliminat|rimoss)/,
  /cancellazione (è stata |e' stata |risulta )?(effettuata|completata|eseguita|confermata)/,
  /(have|has) been (deleted|erased|removed)/,
  /(we have|we've|i have) (deleted|erased|removed|suppressed)/,
  /(deletion|erasure|removal) (is |has been |was )?(complete|completed|confirmed|processed|done)/,
  /(your|the) (data|information|profile|record)s? (was|were|has been|have been|is|are) (deleted|erased|removed|suppressed)/,
  /(added|placed|inserted) (you |it )?(to|in|into) (our |the )?(suppression|opt-out|do[- ]not[- ]contact)/,
];

const DATA_PROVIDED = [
  /in allegato (trovate|trova|troverà|le inviamo|le trasmettiamo|si trova|i dati|la copia)/,
  /(copia|estratto|esportazione) dei (suoi |tuoi |vostri )?dati/,
  /(attached|enclosed) (is|are)\b/,
  /please find (attached|enclosed)/,
  /(a )?copy of your (personal )?data/,
  /we (hold|process|store) the following (personal )?(data|information)/,
  /(trattiamo|conserviamo) (i )?seguenti dati/,
  /(riscontro|risposta) alla (sua|tua|vostra) richiesta di accesso/,
];

const NO_DATA = [
  /non (trattiamo|abbiamo|deteniamo|conserviamo) (alcun )?dat/,
  /nessun dato/,
  /non risultano? (alcun )?(dat|record|informazion)/,
  /we do not (hold|process|have|store) any (personal )?(data|information|record)/,
  /no (record|data|information)s? (was |were )?(found|held|about you)/,
];

const MORE_INFO = [
  /(ulteriori|maggiori|altre) (informazioni|dettagli|dati)/,
  /(additional|further|more) (information|details|data)/,
  /(please )?(provide|send|confirm)(?! your identity)/,
  /puoi (indicare|fornire|confermare)/,
  /(ci )?(serve|servono|occorre|occorrono|necessit)/,
  /could you (please )?(provide|confirm|clarify)/,
];

const matches = (patterns: RegExp[], text: string) => patterns.some((p) => p.test(text));

const QUOTE_START = [
  /^on .{5,200} wrote:\s*$/i,
  /^il .{5,200} ha scritto:\s*$/i,
  /^-{2,}\s*(original message|messaggio originale|forwarded message)/i,
  /^_{5,}\s*$/,
  /^(da|from):\s.+/i,
  /^(inviato|sent):\s.+/i,
];

/** Removes quoted history so phrases from our own request are not mistaken for the broker's answer. */
export function stripQuoted(body: string): string {
  const kept: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (QUOTE_START.some((r) => r.test(t))) break;
    if (t.startsWith('>')) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

/** Heuristic classifier for broker replies (IT/EN). Order matters: negations win over positive phrases. */
export function classifyReply(subject: string, body: string): ReplyLabel {
  const text = `${subject}\n${stripQuoted(body)}`
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, ' ');
  const hasCompleted = matches(COMPLETED, text);
  const hasRefused = matches(REFUSED, text);
  const hasId = matches(ID_REQUIRED, text);
  const hasAuto = matches(AUTO_REPLY, text);

  if (hasId && !hasCompleted) return 'id_required';
  if (hasRefused) return 'refused';
  if (matches(DATA_PROVIDED, text)) return 'data_provided';
  if (hasCompleted) return 'completed';
  if (hasAuto) return 'auto_reply';
  if (matches(MORE_INFO, text)) return 'more_info';
  return 'unknown';
}

/** Access requests: the broker says it holds no data about the person. */
export function indicatesNoData(subject: string, body: string): boolean {
  const text = `${subject}\n${stripQuoted(body)}`.toLowerCase().replace(/[’`´]/g, "'").replace(/\s+/g, ' ');
  return matches(NO_DATA, text);
}
