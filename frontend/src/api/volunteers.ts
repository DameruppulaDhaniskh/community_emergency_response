import client from './client';
import type { PaginatedResponse, VolunteerLocation, VolunteerProfile } from './types';

export interface VolunteerAvailability {
  is_available: boolean;
  societies: Array<{
    society_id: number;
    society_name: string;
    is_available: boolean;
  }>;
}

export async function getAvailability(): Promise<VolunteerAvailability> {
  const res = await client.get<VolunteerAvailability>('/volunteer/availability/');
  return res.data;
}

export async function toggleAvailability(
  isAvailable: boolean
): Promise<{ is_available: boolean; assignments_updated: number }> {
  const res = await client.patch<{ is_available: boolean; assignments_updated: number }>(
    '/volunteer/availability/',
    { is_available: isAvailable }
  );
  return res.data;
}

// ── Milestone 3: Live GPS Location & Volunteer Profile ──

export async function getVolunteerLocation(): Promise<VolunteerLocation> {
  const res = await client.get<VolunteerLocation>('/volunteer/location/');
  return res.data;
}

export async function updateVolunteerLocation(data: {
  latitude: number | string;
  longitude: number | string;
  accuracy?: number | null;
}): Promise<VolunteerLocation> {
  const res = await client.patch<VolunteerLocation>('/volunteer/location/', data);
  return res.data;
}

export async function getVolunteerProfile(): Promise<VolunteerProfile> {
  const res = await client.get<VolunteerProfile>('/volunteer/profile/');
  return res.data;
}

export async function updateVolunteerProfile(
  data: Partial<VolunteerProfile>
): Promise<VolunteerProfile> {
  const res = await client.patch<VolunteerProfile>('/volunteer/profile/', data);
  return res.data;
}

// ── Milestone 3: Admin Volunteer Approvals ──

export async function getAdminVolunteers(params?: {
  status?: 'pending' | 'approved' | 'rejected' | '';
  search?: string;
  page?: number;
}): Promise<PaginatedResponse<VolunteerProfile>> {
  const cleanParams = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== '' && v !== undefined)
  );
  const res = await client.get<PaginatedResponse<VolunteerProfile>>('/admin/volunteers/', {
    params: cleanParams,
  });
  return res.data;
}

export async function approveVolunteer(id: number, reason?: string): Promise<VolunteerProfile> {
  const res = await client.post<VolunteerProfile>(`/admin/volunteers/${id}/approve/`, {
    reason: reason || '',
  });
  return res.data;
}

export async function rejectVolunteer(id: number, reason: string): Promise<VolunteerProfile> {
  const res = await client.post<VolunteerProfile>(`/admin/volunteers/${id}/reject/`, { reason });
  return res.data;
}
