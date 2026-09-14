import { TFunction } from 'i18next'
import { MatchmakingServiceErrorCode } from '../../../../common/matchmaking'
import { jotaiStore } from '../../../jotai-store'
import { cancelFindMatch } from '../../../matchmaking/action-creators'
import { foundMatchAtom, isMatchmakingAtom } from '../../../matchmaking/matchmaking-atoms'
import { isFetchError } from '../../../network/fetch-errors'
import { ALL_COMMAND_SURFACES, defineCommand } from '../command-schema'

function notSearching(t: TFunction): string {
  return t('chat.commands.cancel.notSearching', "You aren't searching for a match.")
}

export const cancelCommand = defineCommand({
  name: 'cancel',
  description: t =>
    t('chat.commands.cancel.description', 'Cancels your current matchmaking search.'),
  surfaces: ALL_COMMAND_SURFACES,
  args: [],

  run({ dispatch, t, emit }) {
    // A command runs outside of React, where reading an atom's current value from the store is how
    // the search state is reached.
    const searching = jotaiStore.get(isMatchmakingAtom)
    const matched = jotaiStore.get(foundMatchAtom) !== undefined

    if (!searching) {
      emit({ kind: 'info', content: notSearching(t) })
      return
    }
    if (matched) {
      // Once a match is found the search is no longer the user's to call off, which is why the
      // gameplay widget drops its Cancel button at the same point.
      emit({
        kind: 'info',
        content: t(
          'chat.commands.cancel.alreadyMatched',
          "A match has already been found, so the search can't be cancelled.",
        ),
      })
      return
    }

    dispatch(
      cancelFindMatch({
        onSuccess: () =>
          emit({
            kind: 'info',
            content: t('chat.commands.cancel.cancelled', 'Matchmaking search cancelled.'),
          }),
        onError: err =>
          isFetchError(err) && err.code === MatchmakingServiceErrorCode.NotInQueue
            ? emit({ kind: 'info', content: notSearching(t) })
            : emit({
                kind: 'error',
                content: t('chat.commands.cancel.error', {
                  defaultValue: "Couldn't cancel the search: {{errorMessage}}",
                  errorMessage: err.message,
                }),
              }),
      }),
    )
  },
})
