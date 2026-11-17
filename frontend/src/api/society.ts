import client from './client';
import type { Society, Block, Flat, ResidentFlatMapping, SocietyAlertPolicy } from './types';

// ── Society ──
export async function getSocieties(search?: string): Promise<Society[]> {
  const params = search ? { search } : {};
  const res = await client.get<Society[]>('/society/', { params });
  return res.data;
}

export async function getSociety(id: number): Promise<Society> {
  const res = await client.get<Society>(`/society/${id}/`);
  return res.data;
}

export async function createSociety(data: Partial<Society>): Promise<Society> {
  const res = await client.post<Society>('/society/', data);
  return res.data;
}

export async function updateSociety(id: number, data: Partial<Society>): Promise<Society> {
  const res = await client.patch<Society>(`/society/${id}/`, data);
  return res.data;
}

export async function deleteSociety(id: number): Promise<void> {
  await client.delete(`/society/${id}/`);
}

// ── Blocks ──
export async function getBlocks(societyId: number): Promise<Block[]> {
  const res = await client.get<Block[]>(`/society/${societyId}/blocks/`);
  return res.data;
}

export async function getBlock(id: number): Promise<Block> {
  const res = await client.get<Block>(`/society/blocks/${id}/`);
  return res.data;
}

export async function createBlock(societyId: number, data: Partial<Block>): Promise<Block> {
  const res = await client.post<Block>(`/society/${societyId}/blocks/`, data);
  return res.data;
}

export async function updateBlock(id: number, data: Partial<Block>): Promise<Block> {
  const res = await client.patch<Block>(`/society/blocks/${id}/`, data);
  return res.data;
}

export async function deleteBlock(id: number): Promise<void> {
  await client.delete(`/society/blocks/${id}/`);
}

// ── Flats ──
export async function getFlats(blockId: number): Promise<Flat[]> {
  const res = await client.get<Flat[]>(`/society/blocks/${blockId}/flats/`);
  return res.data;
}

export async function getFlat(id: number): Promise<Flat> {
  const res = await client.get<Flat>(`/society/flats/${id}/`);
  return res.data;
}

export async function createFlat(blockId: number, data: Partial<Flat>): Promise<Flat> {
  const res = await client.post<Flat>(`/society/blocks/${blockId}/flats/`, data);
  return res.data;
}

export async function updateFlat(id: number, data: Partial<Flat>): Promise<Flat> {
  const res = await client.patch<Flat>(`/society/flats/${id}/`, data);
  return res.data;
}

export async function deleteFlat(id: number): Promise<void> {
  await client.delete(`/society/flats/${id}/`);
}

// ── Resident-Flat Mappings ──
export async function getMappings(): Promise<ResidentFlatMapping[]> {
  const res = await client.get<ResidentFlatMapping[]>('/society/mappings/');
  return res.data;
}

export async function createMapping(data: Partial<ResidentFlatMapping>): Promise<ResidentFlatMapping> {
  const res = await client.post<ResidentFlatMapping>('/society/mappings/', data);
  return res.data;
}

export async function updateMapping(id: number, data: Partial<ResidentFlatMapping>): Promise<ResidentFlatMapping> {
  const res = await client.patch<ResidentFlatMapping>(`/society/mappings/${id}/`, data);
  return res.data;
}

export async function deleteMapping(id: number): Promise<void> {
  await client.delete(`/society/mappings/${id}/`);
}

// ── Milestone 3: Society Policy & Neighbouring Societies ──

export async function getSocietyPolicy(): Promise<SocietyAlertPolicy> {
  const res = await client.get<SocietyAlertPolicy>('/society/policy/');
  return res.data;
}

export async function updateSocietyPolicy(
  data: Partial<SocietyAlertPolicy>
): Promise<SocietyAlertPolicy> {
  const res = await client.patch<SocietyAlertPolicy>('/society/policy/', data);
  return res.data;
}

// ── Public Registration Cascading Endpoints ──
export async function getPublicSocieties(): Promise<Array<{ id: number; name: string; city: string; latitude: number | null; longitude: number | null }>> {
  const res = await client.get('/public/societies/');
  return res.data;
}

export async function getPublicBlocks(societyId: number): Promise<Array<{ id: number; name: string; total_floors: number }>> {
  const res = await client.get(`/public/societies/${societyId}/blocks/`);
  return res.data;
}

export async function getPublicFlats(blockId: number): Promise<Array<{ id: number; flat_number: string; floor: number }>> {
  const res = await client.get(`/public/blocks/${blockId}/flats/`);
  return res.data;
}

// ── Security Duty Controls ──
export interface SecurityDutyStatus {
  on_duty: boolean;
  since: string | null;
  society_id: number | null;
  society_name: string | null;
  post_label: string;
  approval_status: string;
  is_approved: boolean;
}

export async function getSecurityDuty(): Promise<SecurityDutyStatus> {
  const res = await client.get<SecurityDutyStatus>('/security/duty/');
  return res.data;
}

export async function setSecurityDuty(onDuty: boolean): Promise<SecurityDutyStatus> {
  const res = await client.patch<SecurityDutyStatus>('/security/duty/', { on_duty: onDuty });
  return res.data;
}

// ── Admin Staff Approvals (Security & Volunteers) ──
export interface SecurityStaffApprovalItem {
  id: number;
  user_id: number;
  name: string;
  username: string;
  phone: string;
  society_id: number;
  society_name: string;
  post_label: string;
  approval_status: 'pending' | 'approved' | 'rejected';
  approval_note: string;
  created_at: string;
}

export async function getAdminSecurityList(status?: string): Promise<SecurityStaffApprovalItem[]> {
  const params = status ? { status } : {};
  const res = await client.get<SecurityStaffApprovalItem[]>('/admin/security/', { params });
  return res.data;
}

export async function approveSecurityStaff(id: number, note?: string): Promise<void> {
  await client.post(`/admin/security/${id}/approve/`, { note });
}

export async function rejectSecurityStaff(id: number, note?: string): Promise<void> {
  await client.post(`/admin/security/${id}/reject/`, { note });
}

// ── Admin Unlinked Users ──
export interface UnlinkedUserItem {
  id: number;
  username: string;
  name: string;
  phone: string;
  email: string;
  role: string;
  created_at: string;
}

export async function getAdminUnlinkedUsers(): Promise<UnlinkedUserItem[]> {
  const res = await client.get<UnlinkedUserItem[]>('/admin/unlinked-users/');
  return res.data;
}

export async function assignUnlinkedUser(userId: number, flatId: number): Promise<any> {
  const res = await client.post(`/admin/unlinked-users/${userId}/assign/`, { flat_id: flatId });
  return res.data;
}
