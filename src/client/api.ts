interface ApiErrorBody {
  message?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    if (response.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/session') {
      window.dispatchEvent(new CustomEvent('auth-expired'));
    }
    throw new ApiError(body.message || `请求失败 (${response.status})`, response.status);
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  return (contentType.includes('json') ? response.json() : response.text()) as Promise<T>;
}
