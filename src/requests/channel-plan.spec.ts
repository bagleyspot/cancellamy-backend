import { planChannel } from './channel-plan';

const broker = (category: string, channels: Array<{ type: string; value: string; verified?: boolean }>) =>
  ({ name: 'X', category, channels: channels.map((c) => ({ verified: false, ...c })) }) as never;

describe('planChannel', () => {
  it('uses email when available, preferring verified ones', () => {
    const p = planChannel(broker('b2b_enrichment', [{ type: 'email', value: 'a@x.it' }, { type: 'email', value: 'b@x.it', verified: true }]));
    expect(p).toMatchObject({ channel: 'email', email: 'b@x.it' });
  });
  it('falls back to a manual form, then phone, then PEC', () => {
    expect(planChannel(broker('other', [{ type: 'web_form', value: 'https://x.it/f' }]))).toMatchObject({ channel: 'manual', actionReason: 'manual_form' });
    expect(planChannel(broker('other', [{ type: 'phone', value: '800 1' }]))?.manual?.steps[0]).toContain('800 1');
    expect(planChannel(broker('other', [{ type: 'pec', value: 'x@pec.it' }]))?.manual?.email).toBe('x@pec.it');
  });
  it('never contacts the regulator and handles the RPO as a guided action', () => {
    expect(planChannel(broker('regulator', [{ type: 'email', value: 'a@gpdp.it' }]))).toBeNull();
    const rpo = planChannel(broker('opposition_register', [{ type: 'email', value: 'a@rpo.it' }, { type: 'phone', value: '800' }]));
    expect(rpo).toMatchObject({ channel: 'manual', actionReason: 'manual_steps' });
    expect(rpo?.manual?.url).toContain('registrodelleopposizioni');
  });
  it('returns null when no channel is usable', () => {
    expect(planChannel(broker('other', [{ type: 'postal', value: 'Via X 1' }]))).toBeNull();
  });
});
