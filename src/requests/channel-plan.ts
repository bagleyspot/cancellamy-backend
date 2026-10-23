import { Broker } from '../db/schemas';

export interface ChannelPlan {
  channel: 'email' | 'manual';
  email?: string;
  actionReason?: 'manual_form' | 'manual_steps';
  manual?: { steps: string[]; url?: string; phone?: string; email?: string };
}

const RPO_STEPS = [
  'Iscriviti gratis al Registro Pubblico delle Opposizioni: blocca le chiamate commerciali e la posta cartacea indesiderata.',
  "Puoi farlo online dal sito ufficiale, per telefono o per email (i recapiti sono indicati qui sotto).",
  "L'iscrizione ha effetto entro 15 giorni. Non cancella i tuoi dati dagli elenchi: blocca solo i contatti commerciali.",
  "Quando hai finito premi «Fatto».",
];

type Channels = Pick<Broker, 'channels' | 'category' | 'name'>;

const first = (b: Channels, type: string, preferVerified = true) => {
  const list = b.channels.filter((c) => c.type === type);
  return (preferVerified ? list.find((c) => c.verified) : undefined) ?? list[0];
};

/** Decides how a broker is contacted: automatic email or a guided manual action. Returns null if not reachable. */
export function planChannel(b: Channels): ChannelPlan | null {
  if (b.category === 'regulator') return null;
  const email = first(b, 'email');
  const form = first(b, 'web_form');
  const phone = first(b, 'phone');
  const pec = first(b, 'pec');

  if (b.category === 'opposition_register') {
    return {
      channel: 'manual',
      actionReason: 'manual_steps',
      manual: { steps: RPO_STEPS, url: form?.value ?? 'https://www.registrodelleopposizioni.it', phone: phone?.value, email: email?.value },
    };
  }
  if (email) return { channel: 'email', email: email.value };
  if (form) {
    return {
      channel: 'manual',
      actionReason: 'manual_form',
      manual: {
        steps: [
          `Apri il modulo ufficiale di ${b.name}.`,
          'Compila i campi con i tuoi dati e incolla il testo qui sotto nel campo del messaggio (se presente).',
          'Allega un documento di identità solo se il modulo lo richiede esplicitamente.',
          'Quando hai inviato la richiesta premi «Fatto»: da quel momento controlleremo la scadenza dei 30 giorni.',
        ],
        url: form.value,
        phone: phone?.value,
      },
    };
  }
  if (phone) {
    return {
      channel: 'manual',
      actionReason: 'manual_steps',
      manual: {
        steps: [
          `Chiama ${phone.value} e chiedi la cancellazione dei tuoi dati ai sensi degli artt. 17 e 21 GDPR.`,
          "Annota data, ora e nome dell'operatore, e chiedi una conferma scritta.",
          'Quando hai fatto premi «Fatto».',
        ],
        phone: phone.value,
      },
    };
  }
  if (pec) {
    return {
      channel: 'manual',
      actionReason: 'manual_steps',
      manual: {
        steps: [
          `Invia il testo qui sotto dalla tua casella PEC a ${pec.value}: questo indirizzo accetta solo messaggi da PEC.`,
          'Conserva la ricevuta di consegna PEC: vale come prova di invio.',
          'Quando hai inviato premi «Fatto».',
        ],
        email: pec.value,
      },
    };
  }
  return null;
}
