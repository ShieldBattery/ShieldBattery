import { NetcodeV2SlotEvidence } from '../../../common/games/netcode-v2'

/** Merges duplicate samples without summing counts, and isolates conflicting sample identities. */
export function mergePeriodicEvidence(observations: readonly NetcodeV2SlotEvidence[]): {
  observations: NetcodeV2SlotEvidence[]
  conflicts: string[]
} {
  // The same sample can occur as both the current observation and retained history in one response.
  // PostgreSQL cannot update the same conflict target twice in one INSERT.
  const unique = new Map<string, NetcodeV2SlotEvidence>()
  const conflicts = new Set<string>()
  for (const entry of observations) {
    const { slot, observation } = entry
    const identity = `${slot}:${observation.connectionId}:${observation.sampleId}`
    if (conflicts.has(identity)) continue
    const previous = unique.get(identity)
    if (!previous) {
      unique.set(identity, entry)
      continue
    }
    const old = previous.observation
    if (
      old.sequence !== observation.sequence ||
      old.assignmentRevision !== observation.assignmentRevision ||
      old.verdict !== observation.verdict ||
      old.keyId !== observation.keyId ||
      old.body !== observation.body ||
      (old.interruption !== undefined &&
        observation.interruption !== undefined &&
        old.interruption !== observation.interruption)
    ) {
      unique.delete(identity)
      conflicts.add(identity)
      continue
    }
    // Observation time is fill-only metadata. A disagreement cannot suppress cumulative history.
    unique.set(identity, {
      ...previous,
      observation: { ...old, interruption: old.interruption ?? observation.interruption },
      historical: !!previous.historical || !!entry.historical,
      observedAtMs: previous.observedAtMs ?? entry.observedAtMs,
      failureCount:
        previous.failureCount === undefined
          ? entry.failureCount
          : Math.max(previous.failureCount, entry.failureCount ?? 0),
    })
  }
  return { observations: Array.from(unique.values()), conflicts: Array.from(conflicts) }
}
