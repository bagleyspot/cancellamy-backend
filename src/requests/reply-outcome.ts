import type { RequestStatus } from './status';
import { canTransition } from './status';
import type { ReplyLabel } from './reply-classifier';

/** What a broker did when answering (same vocabulary as the registry `observed` outcomes). */
export const REPLY_OUTCOMES = [
  'bounce_no_mailbox',
  'bounce_blocked',
  'no_reply',
  'no_data_held',
  'out_of_office',
  'acknowledged',
  'acknowledged_will_delete',
  'needs_portal',
  'needs_identifier',
  'needs_extra_info',
  'completed',
  'refused',
] as const;
export type ReplyOutcome = (typeof REPLY_OUTCOMES)[number];

type ActionReason = 'manual_form' | 'manual_steps' | 'more_info';

export interface ReplyPlan {
  /** New status, or null to keep the current one. */
  to: RequestStatus | null;
  reason?: ActionReason;
  /** The erasure is considered done: stamp completedAt and schedule the renewal check. */
  completes: boolean;
}

const KEEP: ReplyPlan = { to: null, completes: false };

/** Pure: how an answer moves a request. Closed requests never move; invalid transitions are skipped. */
export function planReply(status: string, outcome: ReplyOutcome): ReplyPlan {
  if (['completed', 'refused', 'cancelled', 'draft', 'queued'].includes(status)) return KEEP;
  const wanted = ((): ReplyPlan => {
    switch (outcome) {
      case 'no_data_held':
      case 'completed':
        return { to: 'completed', completes: true };
      case 'refused':
        return { to: 'refused', completes: false };
      case 'acknowledged':
      case 'acknowledged_will_delete':
        return { to: 'replied', completes: false };
      case 'needs_portal':
        return { to: 'action_required', reason: 'manual_form', completes: false };
      case 'needs_identifier':
      case 'needs_extra_info':
        return { to: 'action_required', reason: 'more_info', completes: false };
      case 'bounce_no_mailbox':
      case 'bounce_blocked':
        return { to: 'action_required', reason: 'manual_steps', completes: false };
      default:
        return KEEP; // out_of_office, no_reply
    }
  })();
  if (wanted.to === null || wanted.to === status) return wanted.to === status ? { ...wanted, to: null } : KEEP;
  return canTransition(status, wanted.to) ? wanted : KEEP;
}

/** Whether the answer is a genuine one (receipts, absence messages and bounces do not count as a first reply). */
export const isGenuineReply = (outcome: ReplyOutcome): boolean =>
  !['acknowledged', 'out_of_office', 'no_reply', 'bounce_no_mailbox', 'bounce_blocked'].includes(outcome);

/** Label stored on the recorded message. */
export function replyLabel(outcome: ReplyOutcome): ReplyLabel {
  switch (outcome) {
    case 'no_data_held':
    case 'completed':
      return 'completed';
    case 'refused':
      return 'refused';
    case 'needs_portal':
    case 'needs_identifier':
    case 'needs_extra_info':
      return 'more_info';
    case 'acknowledged':
    case 'out_of_office':
      return 'auto_reply';
    default:
      return 'unknown';
  }
}
