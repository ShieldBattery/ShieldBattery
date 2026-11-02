import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  GamePointsRefundErrorCode,
  NullifyGamePointsRequest,
  NullifyGamePointsResponse,
} from '../../common/games/games'
import { apiUrl } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { Dialog } from '../material/dialog'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium, labelMedium, singleLine } from '../styles/typography'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Hint = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

const TeamGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const TeamLabel = styled.div`
  ${labelMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

export interface RefundCandidate {
  id: SbUserId
  name: string
}

function refundErrorMessage(code: string | undefined, t: TFunction): string {
  switch (code) {
    case GamePointsRefundErrorCode.GameNotFound:
      return t('gameDetails.refundPoints.errorGameNotFound', 'Game not found.')
    case GamePointsRefundErrorCode.NotCurrentSeason:
      return t(
        'gameDetails.refundPoints.errorNotCurrentSeason',
        'Only current-season games can have their points refunded.',
      )
    case GamePointsRefundErrorCode.NotRanked:
      return t(
        'gameDetails.refundPoints.errorNotRanked',
        'This game has no ranked points to refund (it was not a ranked game).',
      )
    case GamePointsRefundErrorCode.NotRefundable:
      return t(
        'gameDetails.refundPoints.errorNotRefundable',
        'None of the checked players lost ranked points or bonus in this game.',
      )
    case GamePointsRefundErrorCode.InvalidPlayers:
      return t(
        'gameDetails.refundPoints.errorInvalidPlayers',
        'One of the players did not participate in this game.',
      )
    case GamePointsRefundErrorCode.AlreadyRefunded:
      return t(
        'gameDetails.refundPoints.errorAlreadyRefunded',
        "This game's points have already been refunded.",
      )
    default:
      return t(
        'gameDetails.refundPoints.errorGeneric',
        'There was a problem refunding points for this game.',
      )
  }
}

export interface RefundGamePointsDialogProps extends CommonDialogProps {
  gameId: string
  /** The game's human players, by team. */
  teams: ReadonlyArray<ReadonlyArray<RefundCandidate>>
  /** Players to start unchecked, e.g. the reported player when refunding from a report. */
  initialPunishedIds?: ReadonlyArray<SbUserId>
}

/**
 * Lets an admin pick which of a game's players get back the points they lost in it. Everyone left
 * unchecked is treated as punished and keeps their loss.
 */
export function RefundGamePointsDialog({
  gameId,
  teams,
  initialPunishedIds = [],
  onCancel,
  close,
}: RefundGamePointsDialogProps) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()

  const nonEmptyTeams = teams.filter(team => team.length > 0)
  const showTeams = nonEmptyTeams.length > 1 && nonEmptyTeams.some(team => team.length > 1)
  const players = nonEmptyTeams.flat()
  const groups = showTeams ? nonEmptyTeams : [players]

  const [refundedIds, setRefundedIds] = useState<ReadonlySet<SbUserId>>(
    () => new Set(players.filter(p => !initialPunishedIds.includes(p.id)).map(p => p.id)),
  )
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>()

  const toggleRefunded = (userId: SbUserId) => {
    setRefundedIds(prev => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }

  const canSubmit = refundedIds.size > 0

  const onSubmit = () => {
    if (!canSubmit || submitting) {
      return
    }

    setErrorMessage(undefined)
    setSubmitting(true)

    fetchJson<NullifyGamePointsResponse>(apiUrl`games/${gameId}/nullify-points`, {
      method: 'POST',
      body: encodeBodyAsParams<NullifyGamePointsRequest>({
        punishedUserIds: players.filter(p => !refundedIds.has(p.id)).map(p => p.id),
      }),
    })
      .then(response => {
        setSubmitting(false)
        snackbarController.showSnackbar(
          t('gameDetails.refundPoints.success', {
            defaultValue_one: 'Refunded points to {{count}} player.',
            defaultValue: 'Refunded points to {{count}} players.',
            count: response.refundedUsers.length,
          }),
        )
        close()
      })
      .catch((err: unknown) => {
        setSubmitting(false)
        setErrorMessage(refundErrorMessage(isFetchError(err) ? err.code : undefined, t))
      })
  }

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      onClick={onCancel}
      disabled={submitting}
    />,
    <TextButton
      label={t('gameDetails.refundPoints.refundButton', 'Refund points')}
      key='refund'
      onClick={onSubmit}
      disabled={!canSubmit || submitting}
    />,
  ]

  return (
    <StyledDialog
      title={t('gameDetails.refundPoints.title', 'Refund game points')}
      buttons={buttons}
      onCancel={onCancel}>
      <Layout>
        <Hint>
          {t(
            'gameDetails.refundPoints.hint',
            'Checked players get back the ranked and league points they lost in this game. ' +
              "Uncheck anyone who caused the loss. Winners keep their points. This can't be " +
              'undone.',
          )}
        </Hint>
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        {groups.map((team, i) => (
          <TeamGroup key={i}>
            {showTeams ? (
              <TeamLabel>
                {t('game.teamName.number', {
                  defaultValue: 'Team {{teamNumber}}',
                  teamNumber: i + 1,
                })}
              </TeamLabel>
            ) : null}
            {team.map(p => (
              <CheckBox
                key={p.id}
                label={p.name}
                checked={refundedIds.has(p.id)}
                onChange={() => toggleRefunded(p.id)}
                disabled={submitting}
              />
            ))}
          </TeamGroup>
        ))}
      </Layout>
    </StyledDialog>
  )
}
