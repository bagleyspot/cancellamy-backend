import { REPLY_OUTCOMES, isGenuineReply, planReply, replyLabel } from './reply-outcome';
import { parseReplyFile } from './import-replies.cli';

describe('planReply', () => {
  it('completes the request when the broker holds no data or confirms the erasure', () => {
    expect(planReply('sent', 'no_data_held')).toEqual({ to: 'completed', completes: true });
    expect(planReply('replied', 'completed')).toEqual({ to: 'completed', completes: true });
    expect(planReply('overdue', 'no_data_held').to).toBe('completed');
  });

  it('refusal closes the request as refused', () => {
    expect(planReply('sent', 'refused')).toEqual({ to: 'refused', completes: false });
  });

  it('a receipt or an announced deletion moves a sent request to replied and keeps a replied one as it is', () => {
    expect(planReply('sent', 'acknowledged').to).toBe('replied');
    expect(planReply('sent', 'acknowledged_will_delete').to).toBe('replied');
    expect(planReply('replied', 'acknowledged_will_delete').to).toBeNull();
  });

  it('asks the user to act when a portal, an identifier or other data is needed, or the address is dead', () => {
    expect(planReply('sent', 'needs_portal')).toEqual({ to: 'action_required', reason: 'manual_form', completes: false });
    expect(planReply('sent', 'needs_identifier')).toMatchObject({ to: 'action_required', reason: 'more_info' });
    expect(planReply('sent', 'needs_extra_info')).toMatchObject({ to: 'action_required', reason: 'more_info' });
    expect(planReply('sent', 'bounce_no_mailbox')).toMatchObject({ to: 'action_required', reason: 'manual_steps' });
    expect(planReply('sent', 'bounce_blocked')).toMatchObject({ to: 'action_required', reason: 'manual_steps' });
  });

  it('keeps the status for absence messages and missing replies', () => {
    expect(planReply('sent', 'out_of_office').to).toBeNull();
    expect(planReply('sent', 'no_reply').to).toBeNull();
  });

  it('never moves a closed, cancelled or unsent request', () => {
    for (const status of ['completed', 'refused', 'cancelled', 'draft', 'queued']) {
      for (const outcome of REPLY_OUTCOMES) expect(planReply(status, outcome).to).toBeNull();
    }
  });

  it('counts only genuine answers as a first reply and labels messages', () => {
    expect(isGenuineReply('no_data_held')).toBe(true);
    expect(isGenuineReply('needs_portal')).toBe(true);
    for (const o of ['acknowledged', 'out_of_office', 'no_reply', 'bounce_no_mailbox', 'bounce_blocked'] as const) expect(isGenuineReply(o)).toBe(false);
    expect(replyLabel('no_data_held')).toBe('completed');
    expect(replyLabel('needs_portal')).toBe('more_info');
    expect(replyLabel('acknowledged')).toBe('auto_reply');
  });
});

describe('import-replies file', () => {
  it('parses a valid list and rejects malformed entries', () => {
    const ok = parseReplyFile('[{"ref":"CNC-ABCD2345","outcome":"needs_portal","at":"2026-11-05T22:00:00Z","note":"Use the portal","manual":{"url":"https://x.example"}}]');
    expect(ok[0]).toMatchObject({ ref: 'CNC-ABCD2345', outcome: 'needs_portal' });
    expect(() => parseReplyFile('{}')).toThrow('JSON list');
    expect(() => parseReplyFile('[{"ref":"abc","outcome":"acknowledged","at":"2026-11-05"}]')).toThrow('ref must look like');
    expect(() => parseReplyFile('[{"ref":"CNC-ABCD2345","outcome":"maybe","at":"2026-11-05"}]')).toThrow('outcome must be one of');
    expect(() => parseReplyFile('[{"ref":"CNC-ABCD2345","outcome":"acknowledged","at":"soon"}]')).toThrow('ISO date');
  });
});
