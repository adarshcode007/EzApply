const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';

type JsonValue = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

export const apiRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as T & { error?: string } | null;
  if (!response.ok) {
    throw new Error((payload as { error?: string } | null)?.error ?? `Request failed: ${response.status}`);
  }

  return payload as T;
};

export const apiJson = <T extends JsonValue>(body: T) => JSON.stringify(body);
export const apiBase = apiBaseUrl;
