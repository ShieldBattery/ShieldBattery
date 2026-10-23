import Joi from 'joi'
import {
  NetcodeV2EvidenceObservation,
  NetcodeV2SlotEvidence,
} from '../../../common/games/netcode-v2'
import log from '../logging/logger'

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
export const EVIDENCE_TIMESTAMP_SCHEMA = Joi.number()
  .integer()
  .min(0)
  .max(8_640_000_000_000_000)
  .strict()

/** Shared validation for authenticated webhooks and coordinator recovery responses. */
export const EVIDENCE_OBSERVATION_SCHEMA = Joi.object<NetcodeV2EvidenceObservation>({
  sampleId: safeCounter,
  connectionId: boundedBase64(32, 32).required(),
  sequence: safeCounter.required(),
  assignmentRevision: safeCounter.required(),
  verdict: Joi.string().valid('missing', 'unknown_key', 'invalid', 'valid').required(),
  interruption: Joi.string().valid(
    'no_answer',
    'timeout',
    'connection_closed',
    'connection_replaced',
    'slot_departed',
    'revoked',
    'session_retired',
    'silent_slot',
    'desync_evicted',
    'lagging_slot',
    'lobby_violation',
    'stream_closed',
  ),
  keyId: Joi.number().integer().min(0).max(0xffffffff).strict(),
  body: boundedBase64(4028).required(),
})
  .custom((value: NetcodeV2EvidenceObservation, helpers) => {
    if (value.verdict !== 'valid' && value.body !== '') return helpers.error('any.invalid')
    if (value.verdict === 'valid' && value.keyId === undefined) return helpers.error('any.invalid')
    if (value.interruption !== undefined && (value.verdict !== 'missing' || !value.sampleId)) {
      return helpers.error('any.invalid')
    }
    return value
  })
  .unknown(true)

/** History metadata describes failed periodic samples, never administrative cancellation. */
export function hasValidEvidenceHistoryMetadata({
  observation,
  historical,
  failureCount,
}: Pick<NetcodeV2SlotEvidence, 'observation' | 'historical' | 'failureCount'>): boolean {
  if (failureCount !== undefined && historical !== true) return false
  return (
    !historical ||
    (!!observation.sampleId &&
      observation.verdict !== 'valid' &&
      observation.interruption !== 'revoked' &&
      observation.interruption !== 'session_retired')
  )
}

export const SLOT_EVIDENCE_SCHEMA = Joi.object<NetcodeV2SlotEvidence>({
  slot: Joi.number().integer().min(0).max(15).strict().required(),
  observedAtMs: EVIDENCE_TIMESTAMP_SCHEMA,
  observation: EVIDENCE_OBSERVATION_SCHEMA.required(),
  historical: Joi.boolean().strict(),
  failureCount: Joi.number().integer().min(1).max(0xffffffff).strict(),
})
  .custom((value: NetcodeV2SlotEvidence, helpers) =>
    hasValidEvidenceHistoryMetadata(value) ? value : helpers.error('any.invalid'),
  )
  .unknown(true)

// Leave room for additional observation kinds without making validation work unbounded.
const MAX_RECOVERED_OBSERVATIONS = 128

/** A malformed or unsupported entry cannot suppress independent observations in the same batch. */
export function parseSlotEvidenceList(input: unknown): NetcodeV2SlotEvidence[] | undefined {
  if (!Array.isArray(input) || input.length > MAX_RECOVERED_OBSERVATIONS) {
    log.warn('Ignoring malformed coordinator evidence envelope')
    return undefined
  }
  const observations: NetcodeV2SlotEvidence[] = []
  for (const entry of input) {
    const parsed = SLOT_EVIDENCE_SCHEMA.validate(entry)
    if (!parsed.error && parsed.value !== undefined) observations.push(parsed.value)
  }
  const ignored = input.length - observations.length
  if (ignored) log.warn({ ignored }, 'Ignoring unsupported or malformed coordinator observations')
  return observations
}
