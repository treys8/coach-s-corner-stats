// Per-game refresh callback registry. useGameEvents registers its `refresh`
// here on mount; drain.ts and events-client.ts call `triggerRefresh` after
// state-changing actions (drain commit, discard) so the local view stays in
// sync with the server / outbox.
//
// Lives in its own module to avoid a circular import between drain.ts and
// events-client.ts.

type Refresher = () => Promise<unknown>;

const refreshers = new Map<string, Refresher>();

export function registerRefresher(gameId: string, fn: Refresher): () => void {
  refreshers.set(gameId, fn);
  return () => {
    if (refreshers.get(gameId) === fn) refreshers.delete(gameId);
  };
}

export async function triggerRefresh(gameId: string): Promise<void> {
  const fn = refreshers.get(gameId);
  if (!fn) return;
  try {
    await fn();
  } catch {
    // Refresh failures aren't actionable here — caller continues.
  }
}
