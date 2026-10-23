export type RequestStatus =
  | 'queued'
  | 'sent'
  | 'replied'
  | 'action_required'
  | 'overdue'
  | 'escalated'
  | 'completed'
  | 'refused'
  | 'cancelled';

export type RequestGroup = 'in_progress' | 'action_required' | 'completed' | 'not_removable';

export const ALL_STATUSES: RequestStatus[] = [
  'queued',
  'sent',
  'replied',
  'action_required',
  'overdue',
  'escalated',
  'completed',
  'refused',
  'cancelled',
];

export const GROUP_STATUSES: Record<RequestGroup, RequestStatus[]> = {
  in_progress: ['queued', 'sent', 'replied', 'overdue', 'escalated'],
  action_required: ['action_required'],
  completed: ['completed'],
  not_removable: ['refused', 'cancelled'],
};

export function groupOf(status: string): RequestGroup {
  for (const [g, list] of Object.entries(GROUP_STATUSES)) if ((list as string[]).includes(status)) return g as RequestGroup;
  return 'in_progress';
}

export interface RequestCounts {
  total: number;
  inProgress: number;
  actionRequired: number;
  completed: number;
  notRemovable: number;
}

export function emptyCounts(): RequestCounts {
  return { total: 0, inProgress: 0, actionRequired: 0, completed: 0, notRemovable: 0 };
}

export function addToCounts(c: RequestCounts, status: string, n: number): void {
  c.total += n;
  switch (groupOf(status)) {
    case 'in_progress':
      c.inProgress += n;
      break;
    case 'action_required':
      c.actionRequired += n;
      break;
    case 'completed':
      c.completed += n;
      break;
    case 'not_removable':
      c.notRemovable += n;
      break;
  }
}

/** Allowed manual/automatic transitions (backend-enforced; 409 INVALID_STATE otherwise). */
export const TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  queued: ['sent', 'action_required', 'cancelled'],
  sent: ['replied', 'overdue', 'completed', 'refused', 'action_required', 'cancelled'],
  replied: ['sent', 'overdue', 'completed', 'refused', 'action_required', 'cancelled'],
  action_required: ['sent', 'completed', 'refused', 'cancelled'],
  overdue: ['replied', 'completed', 'refused', 'action_required', 'escalated', 'cancelled', 'sent'],
  escalated: ['completed', 'refused', 'cancelled', 'replied'],
  completed: [],
  refused: [],
  cancelled: [],
};

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from as RequestStatus] ?? []).includes(to as RequestStatus);
}
