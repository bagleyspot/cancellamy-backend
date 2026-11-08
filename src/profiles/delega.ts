import type { Profile } from '../db/schemas';
import type { MailMode } from '../config/app-config';

/**
 * When a profile sends from its own mailbox (SMTP or Gmail) the emails are written by the data subject
 * themselves: first person, no mandate and no delega.
 */
export function sendsAsDataSubject(profile: Pick<Profile, 'senderMode'>): boolean {
  return profile.senderMode === 'smtp' || profile.senderMode === 'gmail';
}

/**
 * The delega is only needed when Cancellamy writes on someone's behalf. In mailbox mode every email leaves from the
 * user's own mailbox, so it is never needed there.
 */
export function delegaRequired(profile: Pick<Profile, 'senderMode'>, mailMode: MailMode): boolean {
  return mailMode !== 'mailbox' && !sendsAsDataSubject(profile);
}
