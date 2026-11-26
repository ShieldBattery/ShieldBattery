import { Immutable } from 'immer'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { MatchmakingPreferencesDraft, matchmakingTypeToLabel } from '../../common/matchmaking'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { FindMatchSettingsDialogPayload } from '../dialogs/dialog-type'
import { FilledButton, TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { findMatch } from './action-creators'
import { FindMatchContent } from './find-match-content'
import { isMatchmakingAtom } from './matchmaking-atoms'
import { getMatchmakingPreferencesError } from './preference-validation'

const StyledDialog = styled(Dialog)`
  /*
   * Fits three 196px map thumbnails per row (the same grid as the find-match settings drawer),
   * plus the dialog's padding and room for a scrollbar.
   */
  width: 680px;
`

type FindMatchSettingsDialogProps = CommonDialogProps &
  ReadonlyDeep<FindMatchSettingsDialogPayload['initData']>

/**
 * Shows the settings of each mode in `reviewTypes` in turn, before a search for `queueTypes` starts.
 * Opened when a queue attempt includes modes whose settings can't be searched with, or whose map
 * pool changed since the player last saw it. Dismissing it leaves the player out of the queue.
 */
export function FindMatchSettingsDialog({
  onCancel,
  close,
  reviewTypes,
  queueTypes,
}: FindMatchSettingsDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [index, setIndex] = useState(0)
  const type = reviewTypes[index]
  const isLast = index === reviewTypes.length - 1

  const preferencesByType = useAppSelector(s => s.matchmakingPreferences.byType)
  const mapPool = useAppSelector(s => s.mapPools.byType.get(type))
  const isSearching = useAtomValue(isMatchmakingAtom)
  const canContinue =
    !isSearching &&
    !getMatchmakingPreferencesError(preferencesByType.get(type)?.preferences, mapPool)

  const onConfirm = () => {
    if (!canContinue) {
      return
    }
    if (!isLast) {
      setIndex(index + 1)
      return
    }

    const preferences: Array<Immutable<MatchmakingPreferencesDraft>> = []
    for (const queueType of queueTypes) {
      const prefs = preferencesByType.get(queueType)?.preferences
      if (prefs) {
        preferences.push(prefs)
      }
    }
    dispatch(
      findMatch(preferences, {
        onSuccess: () => {},
        onError: () => {
          // The error UI is shown inside the action creator
        },
      }),
    )
    close()
  }

  return (
    <StyledDialog
      title={matchmakingTypeToLabel(type, t)}
      overline={
        reviewTypes.length > 1
          ? t('matchmaking.findMatchSettings.position', '{{position}} of {{total}}', {
              position: index + 1,
              total: reviewTypes.length,
            })
          : undefined
      }
      showCloseButton={true}
      onCancel={onCancel}
      buttons={[
        <TextButton key='cancel' label={t('common.actions.cancel', 'Cancel')} onClick={onCancel} />,
        <FilledButton
          key='confirm'
          label={
            isLast
              ? t('matchmaking.findMatch.title', 'Find match')
              : t('common.actions.next', 'Next')
          }
          disabled={!canContinue}
          onClick={onConfirm}
        />,
      ]}>
      <FindMatchContent key={type} type={type} disabled={false} />
    </StyledDialog>
  )
}
