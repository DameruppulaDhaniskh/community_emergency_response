export const API_CACHE_NAME = 'safecircle-api-cache';

/**
 * Clears cached authenticated API responses and local user tokens on logout so
 * another user signing in on the same shared device cannot view cached data.
 */
export async function clearSensitiveClientState(): Promise<void> {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  try {
    if (typeof caches !== 'undefined') {
      await caches.delete(API_CACHE_NAME);
    }
  } catch {
    // CacheStorage may be blocked in restricted contexts
  }
}

