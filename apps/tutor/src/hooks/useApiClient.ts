import { useCallback } from 'react';

export function useApiClient(sessionId: string | null, onQuotaExceeded?: () => void) {
  const postJson = useCallback(async <T = any>(url: string, body: Record<string, any>): Promise<T> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId || '',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 429 && data.error === 'quota_exceeded') {
        onQuotaExceeded?.();
        throw new Error('quota_exceeded');
      }
      const err = new Error(data.error || `Server error ${res.status}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return res.json();
  }, [sessionId, onQuotaExceeded]);

  return { postJson };
}
