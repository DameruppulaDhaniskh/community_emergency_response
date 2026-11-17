import client from './client';
import type { UserProfile, UserLookupResult } from './types';

export async function getUsers(): Promise<UserProfile[]> {
  const res = await client.get<UserProfile[]>('/users/');
  return res.data;
}

export async function getUser(id: number): Promise<UserProfile> {
  const res = await client.get<UserProfile>(`/users/${id}/`);
  return res.data;
}

export async function updateUser(id: number, data: Partial<UserProfile>): Promise<UserProfile> {
  const res = await client.patch<UserProfile>(`/users/${id}/`, data);
  return res.data;
}

export async function deleteUser(id: number): Promise<void> {
  await client.delete(`/users/${id}/`);
}

export async function lookupUser(identifier: string): Promise<UserLookupResult> {
  const res = await client.get<UserLookupResult>('/users/lookup/', {
    params: { identifier: identifier.trim() },
  });
  return res.data;
}
