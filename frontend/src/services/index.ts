import type { InterviewService } from './interviewService';
import { getBackendService } from './backendInterviewService';

export type { InterviewService, CanvasSubscription } from './interviewService';
export * from './types';

let _service: InterviewService | null = null;

export function getService(): InterviewService {
  if (!_service) {
    _service = getBackendService();
  }
  return _service;
}

export function setService(service: InterviewService): void {
  _service = service;
}
