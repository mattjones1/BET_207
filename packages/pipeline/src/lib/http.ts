/**
 * HTTP with retries, backoff, timeouts, and a per-provider minimum interval between requests.
 * Never logs request URLs that contain API keys.
 */

export class HttpError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) { super(message); }
}

export interface FetchOptions {
  headers?: Record<string, string>;
  retries?: number;
  timeoutMs?: number;
  /** Name used in errors instead of the URL (which may carry a key). */
  label: string;
  limiter?: RateLimiter;
}

export class RateLimiter {
  private next = 0;
  constructor(private readonly minIntervalMs: number) {}
  async wait(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.minIntervalMs;
    if (at > now) await sleep(at - now);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(url: string, opts: FetchOptions): Promise<Response> {
  const retries = opts.retries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(Math.min(30_000, 1000 * 2 ** (attempt - 1)) + Math.random() * 250);
    await opts.limiter?.wait();
    try {
      const res = await fetch(url, { headers: opts.headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000) });
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      const body = (await res.text()).slice(0, 300);
      lastErr = new HttpError(`${opts.label}: HTTP ${res.status} ${body}`, res.status, retryable);
      if (!retryable) throw lastErr;
      const ra = Number(res.headers.get("retry-after"));
      if (ra > 0) await sleep(Math.min(ra, 120) * 1000);
    } catch (e) {
      if (e instanceof HttpError && !e.retryable) throw e;
      lastErr = e instanceof HttpError ? e : new HttpError(`${opts.label}: ${(e as Error).message}`, 0, true);
    }
  }
  throw lastErr;
}
