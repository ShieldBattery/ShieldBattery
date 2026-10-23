import Joi from 'joi'
import {
  EvidenceSession,
  EvidenceStoreResult,
  insertGameSessionEvidence,
} from '../models/game-session-evidence'
import { insertGameSessionPeriodicEvidence } from '../models/game-session-periodic-evidence'
import { parseSlotEvidenceList } from './evidence-schema'

const SESSION_SCHEMA = Joi.object<EvidenceSession>({
  gameId: Joi.string().guid().required(),
  tenant: Joi.string().max(256).required(),
  session: Joi.number().integer().min(0).max(Number.MAX_SAFE_INTEGER).strict().required(),
})

/** Stores opaque authenticated observations without assigning meaning to their bodies. */
export async function storeRecoveredEvidence(
  session: EvidenceSession,
  input: unknown,
): Promise<EvidenceStoreResult> {
  const sessionCheck = SESSION_SCHEMA.validate(session)
  if (sessionCheck.error) return 'ignored'
  const observations = parseSlotEvidenceList(input)
  if (!observations || (Array.isArray(input) && input.length && !observations.length))
    return 'ignored'
  if (!observations.length) return 'stored'
  const admission = observations.filter(({ observation }) => !observation.sampleId)
  const periodic = observations.filter(({ observation }) => !!observation.sampleId)
  const results: EvidenceStoreResult[] = []
  if (admission.length) results.push(await insertGameSessionEvidence(session, admission))
  if (periodic.length) results.push(await insertGameSessionPeriodicEvidence(session, periodic))
  // Each group is idempotent: a failed second write leaves the first safe to retry.
  if (results.includes('pending')) return 'pending'
  if (results.includes('ignored')) return 'ignored'
  return 'stored'
}
