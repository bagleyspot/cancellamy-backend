export const DISPATCH_QUEUE_NAME = 'request-dispatch';

export interface DispatchJobData {
  requestId: string;
  userId: string;
  profileId: string;
  brokerKey?: string;
  cycle?: number;
  attempt?: number;
}
