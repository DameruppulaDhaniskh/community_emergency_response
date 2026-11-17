import client from './client';
import type { EmergencyContact, CreateContactRequest } from './types';

export async function getContacts(): Promise<EmergencyContact[]> {
  const res = await client.get<EmergencyContact[]>('/contacts/');
  return res.data;
}

export async function getContact(id: number): Promise<EmergencyContact> {
  const res = await client.get<EmergencyContact>(`/contacts/${id}/`);
  return res.data;
}

export async function createContact(data: CreateContactRequest): Promise<EmergencyContact> {
  const res = await client.post<EmergencyContact>('/contacts/', data);
  return res.data;
}

export async function updateContact(
  id: number,
  data: Partial<CreateContactRequest>
): Promise<EmergencyContact> {
  const res = await client.patch<EmergencyContact>(`/contacts/${id}/`, data);
  return res.data;
}

export async function deleteContact(id: number): Promise<void> {
  await client.delete(`/contacts/${id}/`);
}

export async function cancelContactRequest(id: number): Promise<EmergencyContact> {
  const res = await client.post<EmergencyContact>(`/contacts/${id}/cancel/`);
  return res.data;
}

export async function resendContactRequest(id: number): Promise<EmergencyContact> {
  const res = await client.post<EmergencyContact>(`/contacts/${id}/resend/`);
  return res.data;
}

// ── Resident Security Guards & Society Security ──
export interface ResidentSecurityGuardItem {
  id: number;
  resident: number;
  resident_name: string;
  name: string;
  phone: string;
  masked_phone: string;
  guard_type: 'society_security' | 'building_guard';
  linked_user: number | null;
  linked_user_name: string | null;
  linked_username: string | null;
  post_label: string;
  is_active: boolean;
  created_at: string;
}

export interface SocietySecurityStaffItem {
  id: number;
  user_id: number;
  name: string;
  username: string;
  phone: string;
  masked_phone: string;
  post_label: string;
  is_on_duty: boolean;
  society_id: number;
  society_name: string;
}

export async function getResidentSecurityGuards(): Promise<ResidentSecurityGuardItem[]> {
  const res = await client.get<ResidentSecurityGuardItem[]>('/resident/security-guards/');
  return res.data;
}

export async function createResidentSecurityGuard(
  data: Partial<ResidentSecurityGuardItem>
): Promise<ResidentSecurityGuardItem> {
  const res = await client.post<ResidentSecurityGuardItem>('/resident/security-guards/', data);
  return res.data;
}

export async function deleteResidentSecurityGuard(id: number): Promise<void> {
  await client.delete(`/resident/security-guards/${id}/`);
}

export async function getResidentSocietySecurity(): Promise<SocietySecurityStaffItem[]> {
  const res = await client.get<SocietySecurityStaffItem[]>('/resident/society-security/');
  return res.data;
}
