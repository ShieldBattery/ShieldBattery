import { RolledOutcome } from '../../../common/rolled-outcomes'

/**
 * Spreads the settled outcome into a text message's stored or published shape. Only an action line
 * announcing something the server settled carries one, so any other message carries no key for it
 * at all.
 */
export function outcomeField(outcome?: RolledOutcome): { outcome?: RolledOutcome } {
  return outcome ? { outcome } : {}
}
