export const USERNAME_REGEX = /^[A-Za-z0-9_.]{3,30}$/;

/**
 * Gently format Indian phone input as the user types (e.g. "+91 98765 43210"),
 * while allowing clean backspacing and international "+" prefixes.
 */
export function formatPhoneAsTyped(raw: string): string {
  const trimmed = raw.trimStart();
  if (!trimmed) return '';

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return hasPlus ? '+' : '';

  // International non-+91 numbers keep clean "+<digits>"
  if (hasPlus && !digits.startsWith('91')) {
    return '+' + digits.slice(0, 15);
  }

  // Strip country code 91 or leading 0 to format the 10-digit Indian subscriber number
  let national = digits;
  if (hasPlus && digits.startsWith('91')) {
    national = digits.slice(2);
  } else if (!hasPlus && digits.length === 12 && digits.startsWith('91')) {
    national = digits.slice(2);
  } else if (!hasPlus && digits.length === 11 && digits.startsWith('0')) {
    national = digits.slice(1);
  }

  // Only add "+91 " once user has entered at least 1 digit when starting with +91,
  // or format compact "+91 XXXXX XXXXX" as they finish typing 10 digits
  if (national.length === 0) return hasPlus ? '+91 ' : '';
  const part1 = national.slice(0, 5);
  const part2 = national.slice(5, 10);
  if (hasPlus || digits.length >= 10) {
    return part2 ? `+91 ${part1} ${part2}` : `+91 ${part1}`;
  }
  return national;
}

/**
 * Normalize phone before submitting to backend (+91 prefix by default for 10 digits).
 */
export function normalizePhoneForApi(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;
  if (trimmed.startsWith('+')) {
    return '+' + digits;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return '+91' + digits.slice(1);
  }
  if (digits.length === 10) {
    return '+91' + digits;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return '+' + digits;
  }
  return trimmed;
}

/**
 * Parse DRF validation errors { field: ["msg"] } or { detail: "..." }.
 */
export function extractDrfErrors(err: unknown): {
  fieldErrors: Record<string, string>;
  generalError: string;
} {
  const fieldErrors: Record<string, string> = {};
  const axiosErr = err as { response?: { data?: unknown }; message?: string };
  const data = axiosErr?.response?.data;

  if (!data) {
    return {
      fieldErrors,
      generalError:
        axiosErr?.message === 'Network Error'
          ? 'Cannot connect to the server right now. Please try again.'
          : 'Request failed. Please try again.',
    };
  }

  if (typeof data === 'string') {
    return { fieldErrors, generalError: data };
  }

  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    let generalError = '';
    if (typeof obj.detail === 'string') {
      generalError = obj.detail;
    } else if (typeof obj.error === 'string') {
      generalError = obj.error;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'detail' || k === 'error') continue;
      const msg = Array.isArray(v) ? String(v[0] ?? '') : typeof v === 'string' ? v : '';
      if (msg) {
        if (k === 'non_field_errors' && !generalError) {
          generalError = msg;
        } else {
          fieldErrors[k] = msg;
        }
      }
    }
    if (!generalError && Object.keys(fieldErrors).length > 0) {
      generalError = Object.values(fieldErrors)[0];
    }
    return { fieldErrors, generalError };
  }

  return { fieldErrors, generalError: 'Request failed. Please check the form and try again.' };
}

