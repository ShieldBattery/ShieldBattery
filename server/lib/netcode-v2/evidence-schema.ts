import Joi from 'joi'
import {
  NetcodeV2EvidenceObservation,
  NetcodeV2SlotEvidence,
} from '../../../common/games/netcode-v2'

function boundedBase64(maxBytes: number, exactBytes?: number) {
  const schema = Joi.string()
    .max(Math.ceil(maxBytes / 3) * 4)
    .custom((value: string, helpers) => {
      const bytes = Buffer.from(value, 'base64')
      return bytes.length <= maxBytes &&
        (exactBytes === undefined || bytes.length === exactBytes) &&
        bytes.toString('base64') === value
        ? value
        : helpers.error('any.invalid')
    })
  return exactBytes === undefined ? schema.allow('') : schema
}

const safeCounter = Joi.number().integer().min(0).max(Number.MAX_SAFE_INTEGER).strict()

/** Shared validation for authenticated webhooks and coordinator recovery responses. */
export const EVIDENCE_OBSERVATION_SCHEMA = Joi.object<NetcodeV2EvidenceObservation>({
  connectionId: boundedBase64(32, 32).required(),
  sequence: safeCounter.required(),
  assignmentRevision: safeCounter.required(),
  verdict: Joi.string().valid('missing', 'unknown_key', 'invalid', 'valid').required(),
  keyId: Joi.number().integer().min(0).max(0xffffffff).strict(),
  body: boundedBase64(4028).required(),
})
  .custom((value: NetcodeV2EvidenceObservation, helpers) => {
    if (value.verdict !== 'valid' && value.body !== '') return helpers.error('any.invalid')
    if (value.verdict === 'valid' && value.keyId === undefined) return helpers.error('any.invalid')
    return value
  })
  .unknown(true)

export const SLOT_EVIDENCE_SCHEMA = Joi.object<NetcodeV2SlotEvidence>({
  slot: Joi.number().integer().min(0).max(15).strict().required(),
  observation: EVIDENCE_OBSERVATION_SCHEMA.required(),
}).unknown(true)

export const SLOT_EVIDENCE_LIST_SCHEMA = Joi.array().items(SLOT_EVIDENCE_SCHEMA).max(16).required()
