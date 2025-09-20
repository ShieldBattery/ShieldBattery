/**
 * Returns the storage path for a replay file given its ID.
 */
export function replayPath(id: string): string {
  return `replays/${id}.rep`
}
