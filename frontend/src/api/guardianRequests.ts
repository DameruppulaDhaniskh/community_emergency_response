import client from './client';
import type {
  GuardianIncomingRequest,
  GuardianDependent,
  GuardianRequestStatus,
} from './types';

export async function getGuardianIncomingRequests(
  status: GuardianRequestStatus | 'all' = 'pending'
): Promise<GuardianIncomingRequest[]> {
  const res = await client.get<GuardianIncomingRequest[]>('/guardian/requests/', {
    params: { status },
  });
  return res.data;
}

export async function acceptGuardianRequest(
  requestId: number
): Promise<GuardianIncomingRequest> {
  const res = await client.post<GuardianIncomingRequest>(
    `/guardian/requests/${requestId}/accept/`
  );
  return res.data;
}

export async function declineGuardianRequest(
  requestId: number
): Promise<GuardianIncomingRequest> {
  const res = await client.post<GuardianIncomingRequest>(
    `/guardian/requests/${requestId}/decline/`
  );
  return res.data;
}

export async function getGuardianDependents(): Promise<GuardianDependent[]> {
  const res = await client.get<GuardianDependent[]>('/guardian/dependents/');
  return res.data;
}
