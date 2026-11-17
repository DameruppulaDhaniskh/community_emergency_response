import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

// ── Render cold-start wake-up indicator & automatic retry ──
type WakeListener = (waking: boolean) => void;
const wakeListeners = new Set<WakeListener>();
let activeSlowRequests = 0;

function notifyWakeListeners() {
  const waking = activeSlowRequests > 0;
  wakeListeners.forEach((fn) => fn(waking));
}

export function subscribeWakeUp(listener: WakeListener): () => void {
  wakeListeners.add(listener);
  listener(activeSlowRequests > 0);
  return () => {
    wakeListeners.delete(listener);
  };
}

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 45_000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor: attach JWT + track slow cold-start requests ──
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.data instanceof FormData && config.headers) {
    delete config.headers['Content-Type'];
  }

  const reqMeta = config as typeof config & { _wakeTimer?: ReturnType<typeof setTimeout>; _wakeTriggered?: boolean };
  reqMeta._wakeTriggered = false;
  reqMeta._wakeTimer = setTimeout(() => {
    reqMeta._wakeTriggered = true;
    activeSlowRequests += 1;
    notifyWakeListeners();
  }, 3500);

  return config;
});

function clearWakeTimer(config: unknown) {
  const reqMeta = config as { _wakeTimer?: ReturnType<typeof setTimeout>; _wakeTriggered?: boolean } | undefined;
  if (!reqMeta) return;
  if (reqMeta._wakeTimer) {
    clearTimeout(reqMeta._wakeTimer);
    reqMeta._wakeTimer = undefined;
  }
  if (reqMeta._wakeTriggered) {
    reqMeta._wakeTriggered = false;
    activeSlowRequests = Math.max(0, activeSlowRequests - 1);
    notifyWakeListeners();
  }
}

// ── Response interceptor: clear cold-start state + auto-retry transient/cold-start + refresh JWT on 401 ──
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((p) => {
    if (token) p.resolve(token);
    else p.reject(error);
  });
  failedQueue = [];
}

client.interceptors.response.use(
  (res) => {
    clearWakeTimer(res.config);
    return res;
  },
  async (error) => {
    const original = error.config as typeof error.config & {
      _retry?: boolean;
      _coldRetryCount?: number;
    };
    clearWakeTimer(original);

    // Cold-start / gateway wake retry for idempotent GET/HEAD or network timeout before failing
    const isColdError =
      !error.response ||
      [502, 503, 504].includes(error.response?.status) ||
      error.code === 'ECONNABORTED';
    const isSafeMethod = (original?.method || 'get').toLowerCase() === 'get';
    if (
      original &&
      isColdError &&
      isSafeMethod &&
      (original._coldRetryCount || 0) < 2 &&
      typeof navigator !== 'undefined' &&
      navigator.onLine
    ) {
      original._coldRetryCount = (original._coldRetryCount || 0) + 1;
      activeSlowRequests += 1;
      notifyWakeListeners();
      try {
        await new Promise((r) => setTimeout(r, 2500));
        return await client(original);
      } finally {
        activeSlowRequests = Math.max(0, activeSlowRequests - 1);
        notifyWakeListeners();
      }
    }

    if (
      error.response?.status !== 401 ||
      !original ||
      original._retry ||
      original.url?.includes('/auth/login') ||
      original.url?.includes('/auth/token/refresh')
    ) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({
          resolve: (token: string) => {
            original.headers.Authorization = `Bearer ${token}`;
            resolve(client(original));
          },
          reject,
        });
      });
    }

    original._retry = true;
    isRefreshing = true;

    const refresh = localStorage.getItem('refresh_token');
    if (!refresh) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      window.location.href = '/login';
      return Promise.reject(error);
    }

    try {
      const { data } = await axios.post(`${API_BASE_URL}/auth/token/refresh/`, {
        refresh,
      });

      localStorage.setItem('access_token', data.access);
      if (data.refresh) {
        localStorage.setItem('refresh_token', data.refresh);
      }

      processQueue(null, data.access);
      original.headers.Authorization = `Bearer ${data.access}`;
      return client(original);
    } catch (refreshError) {
      processQueue(refreshError, null);
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      window.location.href = '/login';
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export default client;
