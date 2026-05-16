import { toast } from "sonner";

export interface PostBody {
  client_event_id: string;
  sequence_number: number;
  event_type: string;
  payload: unknown;
}

export interface PostEventOptions {
  /** Called with `true` when a retry is scheduled and `false` once the
   *  request resolves (success or terminal failure). Lets the hook flip
   *  a `retrying` flag for the UI status indicator. */
  onRetryingChange?: (retrying: boolean) => void;
  /** Test seam: override the backoff delays. Defaults to 1000/2000/4000ms.
   *  An empty array disables retry entirely. */
  retryDelaysMs?: number[];
}

const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return (body && (body.error ?? body.message)) ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

/**
 * POST a game event with automatic retry on transient failures.
 *
 * Server idempotency ((game_id, client_event_id) unique) makes retries
 * safe: a duplicate POST returns 200 and the rollup re-runs. Network
 * errors and HTTP 5xx are retried; HTTP 4xx is treated as a client bug
 * and fails immediately. On final failure a persistent toast surfaces a
 * manual Retry button.
 */
export async function postEvent(
  gameId: string,
  body: PostBody,
  options: PostEventOptions = {},
): Promise<boolean> {
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const maxAttempts = delays.length + 1;
  let lastError = "request failed";
  let retryingFlagSet = false;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const res = await fetch(`/api/games/${gameId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        if (retryingFlagSet) options.onRetryingChange?.(false);
        return true;
      }
      // Client-side error: surface immediately, don't retry.
      if (res.status >= 400 && res.status < 500) {
        lastError = await readErrorDetail(res);
        if (retryingFlagSet) options.onRetryingChange?.(false);
        toast.error(`Couldn't save event: ${lastError}`);
        return false;
      }
      lastError = await readErrorDetail(res);
    } catch (err) {
      // Network failure, DNS, offline, aborted, etc.
      lastError = err instanceof Error ? err.message : String(err);
    }

    // If there are more attempts left, schedule a backoff and try again.
    if (attempt < delays.length) {
      if (!retryingFlagSet) {
        retryingFlagSet = true;
        options.onRetryingChange?.(true);
      }
      await sleep(delays[attempt]);
    }
  }

  if (retryingFlagSet) options.onRetryingChange?.(false);
  // Out of retries — surface a persistent toast with a manual Retry that
  // re-enters this function (idempotent on the server). The toast carries
  // no onRetryingChange callback; the live-scoring hook is no longer
  // gating UI on this attempt.
  toast.error(`Couldn't save event: ${lastError}`, {
    duration: Infinity,
    action: {
      label: "Retry",
      onClick: () => {
        void postEvent(gameId, body, options);
      },
    },
  });
  return false;
}
