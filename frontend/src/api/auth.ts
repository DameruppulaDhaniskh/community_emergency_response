import client from './client';
import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  UserProfile,
  ChangePasswordRequest,
} from './types';

export async function login(data: LoginRequest): Promise<LoginResponse> {
  const res = await client.post<LoginResponse>('/auth/login/', data);
  return res.data;
}

export async function register(data: RegisterRequest): Promise<UserProfile> {
  const res = await client.post<UserProfile>('/auth/register/', data);
  return res.data;
}

export async function logout(refresh: string): Promise<void> {
  await client.post('/auth/logout/', { refresh });
}

export async function getProfile(): Promise<UserProfile> {
  const res = await client.get<UserProfile>('/auth/profile/');
  return res.data;
}

export async function updateProfile(data: Partial<UserProfile>): Promise<UserProfile> {
  const res = await client.patch<UserProfile>('/auth/profile/', data);
  return res.data;
}

export async function changePassword(data: ChangePasswordRequest): Promise<{ detail: string }> {
  const res = await client.post<{ detail: string }>('/auth/change-password/', data);
  return res.data;
}

// ── BACKEND GAP: forgot password ──
// The backend does not have password reset. This is a mock.
export async function forgotPassword(_email: string): Promise<{ detail: string }> {
  console.warn('[MOCK] forgotPassword — backend does not support this yet');
  return { detail: 'If that email is registered, a reset link has been sent.' };
}

export async function resetPassword(_token: string, _newPassword: string): Promise<{ detail: string }> {
  console.warn('[MOCK] resetPassword — backend does not support this yet');
  return { detail: 'Password has been reset successfully.' };
}
