/**
 * Rate-limited HTTP fetcher for matsne.gov.ge.
 *
 * - Browser-like headers (required by Matsne WAF)
 * - 1.2s minimum delay between requests
 * - Retry with exponential backoff on transient failures
 * - Explicit block detection for "Access Denied" responses
 */

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const MIN_DELAY_MS = 1200;
const DEFAULT_TIMEOUT_MS = 25000;

let lastRequestAt = 0;

export interface FetchResult {
  status: number;
  body: string;
  contentType: string;
  url: string;
  blocked: boolean;
  blockReferenceId?: string;
}

export interface BinaryFetchResult {
  status: number;
  body: Buffer;
  contentType: string;
  url: string;
  blocked: boolean;
  blockReferenceId?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function applyRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < MIN_DELAY_MS) {
    await sleep(MIN_DELAY_MS - elapsed);
  }
  lastRequestAt = Date.now();
}

function detectAccessBlock(body: string): { blocked: boolean; referenceId?: string } {
  if (!/Access Denied|Oops! Something went wrong/i.test(body)) {
    return { blocked: false };
  }

  const refMatch = body.match(/Ref ID:\s*([0-9]+)/i);
  return {
    blocked: true,
    referenceId: refMatch?.[1],
  };
}

/**
 * Fetch a Matsne URL with retries and rate limiting.
 */
export async function fetchWithRateLimit(url: string, maxRetries = 3): Promise<FetchResult> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await applyRateLimit();

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ka,en;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      const body = await response.text();
      const block = detectAccessBlock(body);
      const status = response.status;

      if ((status === 429 || status >= 500) && attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt + 1) * 1000;
        await sleep(backoffMs);
        continue;
      }

      return {
        status,
        body,
        contentType: response.headers.get('content-type') ?? '',
        url: response.url,
        blocked: block.blocked,
        blockReferenceId: block.referenceId,
      };
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt + 1) * 1000;
        await sleep(backoffMs);
        continue;
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Failed to fetch ${url}: ${message}`);
}

/**
 * Fetch a Matsne URL as binary (for downloadable DOC files), with retries and rate limiting.
 */
export async function fetchBinaryWithRateLimit(
  url: string,
  maxRetries = 3
): Promise<BinaryFetchResult> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await applyRateLimit();

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ka,en;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      const body = Buffer.from(await response.arrayBuffer());
      const block = detectAccessBlock(body.toString('utf8'));
      const status = response.status;

      if ((status === 429 || status >= 500) && attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt + 1) * 1000;
        await sleep(backoffMs);
        continue;
      }

      return {
        status,
        body,
        contentType: response.headers.get('content-type') ?? '',
        url: response.url,
        blocked: block.blocked,
        blockReferenceId: block.referenceId,
      };
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt + 1) * 1000;
        await sleep(backoffMs);
        continue;
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Failed to fetch binary ${url}: ${message}`);
}
