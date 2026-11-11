import { TFunction } from 'i18next'

/** How alike a file is to the file of a map suggested as the one it's a version of. */
export interface PublishEvidence {
  /** The share of the walkable terrain the two files have in common, from 0 to 1. */
  similarity: number
  /** Whether both files are melee maps, or both are UMS maps. */
  sameKind: boolean
  /** How alike the two files' triggers are, from 0 to 1, when both are UMS maps. */
  triggerSimilarity?: number | null
  /** Whether the files have the same resources. */
  sameResources: boolean
}

/** The terrain similarity from which two files count as having the same terrain. */
const SAME_TERRAIN_SIMILARITY = 0.995
/** The trigger similarity from which two files count as having the same triggers. */
const SAME_TRIGGERS_SIMILARITY = 0.9
/** The trigger similarity below which two files count as having different triggers. */
const DIFFERENT_TRIGGERS_SIMILARITY = 0.5

/**
 * Says why a map is suggested as the one a file is a version of, e.g.
 * `97% same terrain · same resources`.
 */
export function publishEvidenceText(evidence: PublishEvidence, t: TFunction): string {
  const parts: string[] = []
  if (evidence.similarity >= SAME_TERRAIN_SIMILARITY) {
    parts.push(t('maps.publish.sameTerrain', 'same terrain'))
  } else {
    // Rounded down, so files that aren't the same never read as 100%. The small bias keeps
    // floating point error (0.29 * 100 = 28.999…) from taking a whole percent off.
    const percent = Math.floor(evidence.similarity * 100 + 1e-9)
    parts.push(t('maps.publish.terrainPercent', '{{percent}}% same terrain', { percent }))
  }
  if (evidence.sameResources) {
    parts.push(t('maps.publish.sameResources', 'same resources'))
  }
  if (!evidence.sameKind) {
    parts.push(t('maps.publish.differentKind', 'different game type'))
  }
  const triggers = evidence.triggerSimilarity
  if (triggers !== null && triggers !== undefined) {
    if (triggers >= SAME_TRIGGERS_SIMILARITY) {
      parts.push(t('maps.publish.sameTriggers', 'same triggers'))
    } else if (triggers < DIFFERENT_TRIGGERS_SIMILARITY) {
      parts.push(t('maps.publish.differentTriggers', 'different triggers'))
    }
  }
  return parts.join(' · ')
}
