import { SbUserId } from '../../common/users/sb-user-id'
import { ChatCommand } from './commands/command-schema'

/** How many rows a palette shows; more would need scrolling. */
export const MAX_TYPEAHEAD_ROWS = 10

/** What a suggestion row shows next to its text. */
export type TypeaheadVisual =
  /** An avatar, faded along with the text while the user is offline. */
  | { kind: 'user'; userId: SbUserId; online: boolean }
  /** The emoji character itself as the row's icon. */
  | { kind: 'emoji'; emoji: string }
  /** A command, faded while it can't be run where it was typed. */
  | { kind: 'command'; command: ChatCommand; unavailable: boolean }
  /** Text only, as channel names and enum values are shown. */
  | { kind: 'plain' }

export interface TypeaheadSuggestion {
  /** Unique within its list, for rendering. */
  key: string
  text: string
  secondaryText?: string
  visual: TypeaheadVisual
  /** Replaces the matched text when the suggestion is accepted. */
  insertText: string
  /**
   * Whether the matched text already spells this suggestion, so accepting it would change nothing
   * but what follows it.
   */
  exact: boolean
}

export interface TypeaheadMatch {
  /** Index in the message where the text being completed starts. */
  start: number
  /** The text being completed: from `start` up to the caret. */
  matchedText: string
  /** Rows to offer, possibly still loading. Empty means the palette closes. */
  suggestions: ReadonlyArray<TypeaheadSuggestion> | Promise<ReadonlyArray<TypeaheadSuggestion>>
  /** Enter on an `exact` suggestion submits the message instead of accepting the suggestion. */
  submitOnExact?: boolean
  /** Space accepts the suggestion when it is the only one offered and it is not `exact`. */
  spaceAcceptsSingle?: boolean
}

export interface TypeaheadProvider {
  /** Distinguishes what a provider renders from what another did (list state resets when it changes). */
  id: string
  /**
   * What the provider offers for the caret at the end of `textBeforeCaret`; undefined when nothing
   * there is its business.
   */
  match(textBeforeCaret: string): TypeaheadMatch | undefined
  /** Told when one of its suggestions was accepted. */
  onAccept?(suggestion: TypeaheadSuggestion): void
}

export interface TypeaheadResult {
  provider: TypeaheadProvider
  match: TypeaheadMatch
}

/** Asks the providers in order; the first to claim the caret wins even if it ends up with no rows. */
export function matchTypeahead(
  providers: ReadonlyArray<TypeaheadProvider>,
  textBeforeCaret: string,
): TypeaheadResult | undefined {
  for (const provider of providers) {
    const match = provider.match(textBeforeCaret)
    if (match) {
      return { provider, match }
    }
  }

  return undefined
}
