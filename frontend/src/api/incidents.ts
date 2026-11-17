import client from './client';
import type {
  AvailableVolunteer,
  GuardianHandoffRequest,
  Incident,
  IncidentEvidence,
  IncidentHistory,
  IncidentMessage,
  IncidentStatus,
  IncidentStatusResponse,
  PaginatedResponse,
  ReportIncidentResponse,
  ResidentEscalationSettings,
  ResidentEscalationSettingsResponse,
  SOSRequest,
  SOSResponse,
} from './types';

// ── Real endpoints ──
export async function triggerSOS(data: SOSRequest): Promise<SOSResponse> {
  const res = await client.post<SOSResponse>('/incidents/sos/', data);
  return res.data;
}

export async function createIncident(
  data: FormData,
  onUploadProgress?: (pct: number) => void
): Promise<ReportIncidentResponse> {
  const res = await client.post<ReportIncidentResponse>('/incidents/', data, {
    onUploadProgress: (evt) => {
      if (onUploadProgress && evt.total) {
        onUploadProgress(Math.round((evt.loaded * 100) / evt.total));
      }
    },
  });
  return res.data;
}

export async function getIncidents(params?: {
  status?: IncidentStatus | '';
  category?: string;
  emergency_type?: string;
  assigned_to?: string | number;
  is_escalated?: boolean;
  search?: string;
  ordering?: string;
}): Promise<Incident[]> {
  const cleanParams = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== '' && v !== undefined && v !== null)
  );
  const res = await client.get<Incident[]>('/incidents/', { params: cleanParams });
  return res.data;
}

export async function getIncidentsPaginated(params?: {
  status?: IncidentStatus | '';
  category?: string;
  assigned_to?: string | number;
  search?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
}): Promise<PaginatedResponse<Incident>> {
  const cleanParams: Record<string, unknown> = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== '' && v !== undefined && v !== null)
  );
  if (!cleanParams.page) cleanParams.page = 1;
  if (!cleanParams.page_size) cleanParams.page_size = 10;
  const res = await client.get<PaginatedResponse<Incident>>('/incidents/', { params: cleanParams });
  return res.data;
}

export async function getIncident(id: number): Promise<Incident> {
  const res = await client.get<Incident>(`/incidents/${id}/`);
  return res.data;
}

export async function getIncidentStatus(id: number): Promise<IncidentStatusResponse> {
  const res = await client.get<IncidentStatusResponse>(`/incidents/${id}/status/`);
  return res.data;
}

export async function getResidentIncidents(): Promise<Incident[]> {
  const res = await client.get<Incident[]>('/resident/incidents/');
  return res.data;
}

export async function getVolunteerIncidents(params?: {
  status?: IncidentStatus | '';
}): Promise<Incident[]> {
  const cleanParams = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== '' && v !== undefined)
  );
  const res = await client.get<Incident[]>('/volunteer/incidents/', { params: cleanParams });
  return res.data;
}

export async function updateIncidentStatus(
  id: number,
  status: IncidentStatus,
  note?: string,
  closeReason?: string
): Promise<Incident> {
  const res = await client.patch<Incident>(`/incidents/${id}/status/`, {
    status,
    note: note || '',
    close_reason: closeReason || '',
  });
  return res.data;
}

export async function assignVolunteer(
  incidentId: number,
  volunteerId: number,
  note?: string
): Promise<Incident> {
  const res = await client.post<Incident>(`/incidents/${incidentId}/assign/`, {
    volunteer_id: volunteerId,
    note: note || '',
  });
  return res.data;
}

export async function getAvailableVolunteers(incidentId?: number): Promise<AvailableVolunteer[]> {
  const params = incidentId ? { incident_id: incidentId } : undefined;
  const res = await client.get<AvailableVolunteer[]>('/volunteers/available/', { params });
  return res.data;
}

export async function getIncidentHistory(id: number): Promise<IncidentHistory[]> {
  const res = await client.get<IncidentHistory[]>(`/incidents/${id}/history/`);
  return res.data;
}

export async function getIncidentEvidence(id: number): Promise<IncidentEvidence[]> {
  const res = await client.get<IncidentEvidence[]>(`/incidents/${id}/evidence/`);
  return res.data;
}

export async function uploadEvidence(
  incidentId: number,
  files: File | File[]
): Promise<IncidentEvidence | IncidentEvidence[]> {
  const list = Array.isArray(files) ? files : [files];
  const formData = new FormData();
  list.forEach((file) => formData.append('images', file));
  const res = await client.post<IncidentEvidence | IncidentEvidence[]>(
    `/incidents/${incidentId}/evidence/`,
    formData
  );
  return res.data;
}

export async function escalateIncident(id: number, note?: string): Promise<Incident> {
  const res = await client.post<Incident>(`/incidents/${id}/escalate/`, { note: note || '' });
  return res.data;
}

// ── Milestone 3: Escalation, Guardian Ack & Handoff, Incident Location ──

export async function getEscalationSettings(): Promise<ResidentEscalationSettingsResponse> {
  const res = await client.get<ResidentEscalationSettingsResponse>('/resident/escalation-settings/');
  return res.data;
}

export async function updateEscalationSettings(
  data: Partial<ResidentEscalationSettings>
): Promise<ResidentEscalationSettingsResponse> {
  const res = await client.put<ResidentEscalationSettingsResponse>('/resident/escalation-settings/', data);
  return res.data;
}

export async function guardianAcknowledge(incidentId: number): Promise<Incident> {
  const res = await client.post<Incident>(`/incidents/${incidentId}/guardian-ack/`);
  return res.data;
}

export async function guardianHandoff(
  incidentId: number,
  data: GuardianHandoffRequest
): Promise<Incident> {
  const res = await client.post<Incident>(`/incidents/${incidentId}/handoff/`, data);
  return res.data;
}

export async function volunteerAccept(incidentId: number): Promise<Incident> {
  const res = await client.post<Incident>(`/incidents/${incidentId}/accept/`);
  return res.data;
}

export async function updateIncidentLocation(
  incidentId: number,
  data: { latitude: number | string; longitude: number | string; accuracy?: number }
): Promise<Incident> {
  const res = await client.patch<Incident>(`/incidents/${incidentId}/location/`, data);
  return res.data;
}

// ── Optional in-memory discussion adapter used inside SOSFlow modal ──
const mockMessages: Record<number, IncidentMessage[]> = {};

export async function getIncidentMessages(incidentId: number): Promise<IncidentMessage[]> {
  return mockMessages[incidentId] || [];
}

export async function postIncidentMessage(
  incidentId: number,
  userId: number,
  userName: string,
  userRole: string,
  message: string
): Promise<IncidentMessage> {
  const msg: IncidentMessage = {
    id: `msg-${Date.now()}`,
    incident_id: incidentId,
    user_id: userId,
    user_name: userName,
    user_role: userRole as IncidentMessage['user_role'],
    message,
    created_at: new Date().toISOString(),
  };
  if (!mockMessages[incidentId]) mockMessages[incidentId] = [];
  mockMessages[incidentId].push(msg);
  return msg;
}

// ── Security Personnel Actions & Workspace ──

export async function securityAckIncident(incidentId: number): Promise<Incident> {
  const res = await client.post<Incident>(`/incidents/${incidentId}/security-ack/`);
  return res.data;
}

export async function getSecurityIncidents(): Promise<Incident[]> {
  const res = await client.get<Incident[]>('/security/incidents/');
  return res.data;
}

// ── Volunteer Candidate Search for Guardian Handoff ──

export interface NearbyVolunteerCandidate {
  id: number;
  name: string;
  username: string;
  area_label: string;
  block_name: string;
  same_block: boolean;
  distance_km: number | null;
  society_name: string;
}

export async function getNearbyVolunteers(
  incidentId: number,
  params?: { q?: string; radius_km?: number }
): Promise<NearbyVolunteerCandidate[]> {
  const res = await client.get<NearbyVolunteerCandidate[]>(
    `/incidents/${incidentId}/nearby-volunteers/`,
    { params }
  );
  return res.data;
}

// ── Escalation Diagnostics ──

export interface EscalationDiagnostics {
  incident_id: number;
  resident: {
    id: number;
    username: string;
    society_linked: boolean;
    society_name: string | null;
    block_name: string | null;
    flat_number: string | null;
  };
  location: {
    has_coordinates: boolean;
    latitude: number | null;
    longitude: number | null;
    accuracy?: number | null;
    source: string;
  };
  guardians: {
    primary: { configured: boolean; verified: boolean; name: string | null };
    secondary: { configured: boolean; verified: boolean; name: string | null };
  };
  security: {
    has_security_guard_configured: boolean;
    resident_guard_count: number;
    society_security_approved_count: number;
    society_security_on_duty_count: number;
    security_alerted: boolean;
  };
  volunteers: {
    search_radius_km: number;
    total_approved_volunteers: number;
    available_volunteers: number;
    volunteers_notified_count: number;
  };
  escalation_status: {
    is_escalated: boolean;
    escalate_at: string | null;
    escalation_trigger: string;
    plan: any;
  };
}

export async function getEscalationDiagnostics(incidentId: number): Promise<EscalationDiagnostics> {
  const res = await client.get<EscalationDiagnostics>(
    `/incidents/${incidentId}/escalation-diagnostics/`
  );
  return res.data;
}
