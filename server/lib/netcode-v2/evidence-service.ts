import Joi from 'joi'
import { NetcodeV2SlotEvidence } from '../../../common/games/netcode-v2'
import {
  EvidenceSession,
  EvidenceStoreResult,
  insertGameSessionEvidence,
} from '../models/game-session-evidence'
import { SLOT_EVIDENCE_LIST_SCHEMA } from './evidence-schema'

const SESSION_SCHEMA = Joi.object<EvidenceSession>({
  gameId: Joi.string().guid().required(),
  tenant: Joi.string().max(256).required(),
  session: Joi.number().integer().min(0).max(Number.MAX_SAFE_INTEGER).strict().required(),
})

/** Stores opaque authenticated observations without assigning meaning to their bodies. */
export async function storeRecoveredEvidence(
  session: EvidenceSession,
  observations: NetcodeV2SlotEvidence[],
): Promise<EvidenceStoreResult> {
  const sessionCheck = SESSION_SCHEMA.validate(session)
  const observationsCheck = SLOT_EVIDENCE_LIST_SCHEMA.validate(observations)
  if (sessionCheck.error || observationsCheck.error) return 'ignored'
  if (!observations.length) return 'stored'
  return insertGameSessionEvidence(session, observations)
}
