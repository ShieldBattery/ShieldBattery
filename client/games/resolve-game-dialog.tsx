import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { GameSource } from '../../common/games/configuration'
import { isTeamType } from '../../common/games/game-type'
import { ManuallyResolveGameRequest, ManuallyResolveGameResponse } from '../../common/games/games'
import { GameResultErrorCode, ReconciledResult, getResultLabel } from '../../common/games/results'
import { apiUrl } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { RaceIcon } from '../lobbies/race-icon'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodySmall, labelMedium, singleLine } from '../styles/typography'
import { viewGame } from './action-creators'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Hint = styled.div`
  ${bodySmall};
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

const PlayerRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const StyledRaceIcon = styled(RaceIcon)`
  flex-shrink: 0;
  width: 28px;
  height: 28px;
`

const PlayerName = styled.div`
  ${bodyLarge};
  ${singleLine};
  flex-grow: 1;
`

const OutcomeSelect = styled(Select)`
  width: 128px;
  flex-shrink: 0;
`

type Outcome = 'win' | 'loss' | 'draw'

export interface ResolveGameResultsDialogProps extends CommonDialogProps {
  gameId: string
}

export function ResolveGameResultsDialog({
  gameId,
  onCancel,
  close,
}: ResolveGameResultsDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const game = useAppSelector(s => s.games.byId.get(gameId))
  const usersById = useAppSelector(s => s.users.byId)

  const resultsById = new Map(game?.results ?? [])

  const [outcomes, setOutcomes] = useState<Map<SbUserId, Outcome>>(() => {
    const initial = new Map<SbUserId, Outcome>()
    for (const team of game?.config.teams ?? []) {
      for (const p of team) {
        if (p.isComputer) {
          continue
        }
        const stored = resultsById.get(p.id)?.result
        if (stored === 'win' || stored === 'loss' || stored === 'draw') {
          initial.set(p.id, stored)
        }
      }
    }
    return initial
  })
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>()

  if (!game) {
    return null
  }

  const isMatchmaking = game.config.gameSource === GameSource.Matchmaking
  const showTeams = isTeamType(game.config.gameType)
  const outcomeOptions: ReconciledResult[] = isMatchmaking
    ? ['win', 'loss']
    : ['win', 'loss', 'draw']

  const humanPlayers = game.config.teams.flatMap(team => team.filter(p => !p.isComputer))
  const canSubmit = humanPlayers.length > 0 && humanPlayers.every(p => outcomes.has(p.id))

  const onSubmit = () => {
    if (!canSubmit || submitting) {
      return
    }

    setErrorMessage(undefined)
    setSubmitting(true)

    const results = humanPlayers.map(p => ({ userId: p.id, result: outcomes.get(p.id)! }))

    fetchJson<ManuallyResolveGameResponse>(apiUrl`games/${gameId}/manual-resolution`, {
      method: 'POST',
      body: JSON.stringify({ results } satisfies ManuallyResolveGameRequest),
    })
      .then(response => {
        setSubmitting(false)
        // Completed games aren't subscribed to socket updates, so the page won't hear about the
        // change on its own — refetch to show the newly assigned results (and any rating changes).
        dispatch(viewGame(gameId, { onSuccess: () => {}, onError: () => {} }))
        snackbarController.showSnackbar(
          response.ratingsApplied
            ? t(
                'gameDetails.resolveDialog.successWithPoints',
                'Results updated and points applied.',
              )
            : t('gameDetails.resolveDialog.success', 'Results updated.'),
        )
        close()
      })
      .catch((err: unknown) => {
        setSubmitting(false)
        const code = isFetchError(err) ? err.code : undefined
        if (code === GameResultErrorCode.NotDisputable) {
          setErrorMessage(
            t(
              'gameDetails.resolveDialog.errorNotDisputable',
              'This game is no longer awaiting resolution.',
            ),
          )
        } else if (code === GameResultErrorCode.InvalidResults) {
          setErrorMessage(
            t(
              'gameDetails.resolveDialog.errorInvalidResults',
              "These results aren't valid for this game. Exactly one team must win.",
            ),
          )
        } else {
          setErrorMessage(
            t('gameDetails.resolveDialog.errorGeneric', 'Something went wrong. Please try again.'),
          )
        }
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
      label={t('gameDetails.resolveDialog.resolveButton', 'Resolve')}
      key='resolve'
      onClick={onSubmit}
      disabled={!canSubmit || submitting}
    />,
  ]

  return (
    <StyledDialog
      title={t('gameDetails.resolveDialog.title', 'Resolve game results')}
      buttons={buttons}
      onCancel={onCancel}>
      <Layout>
        {isMatchmaking ? (
          <Hint>
            {t('gameDetails.resolveDialog.matchmakingHint', 'Exactly one team must win.')}
          </Hint>
        ) : null}
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        {game.config.teams.map((team, i) => {
          const players = team.filter(p => !p.isComputer)
          if (players.length === 0) {
            return null
          }

          return (
            <TeamGroup key={i}>
              {showTeams ? (
                <TeamLabel>
                  {t('game.teamName.number', {
                    defaultValue: 'Team {{teamNumber}}',
                    teamNumber: i + 1,
                  })}
                </TeamLabel>
              ) : null}
              {players.map(p => {
                const storedResult = resultsById.get(p.id)
                const race = storedResult?.race ?? p.race
                const name = usersById.get(p.id)?.name ?? ''

                return (
                  <PlayerRow key={p.id}>
                    <StyledRaceIcon race={race} />
                    <PlayerName>{name}</PlayerName>
                    <OutcomeSelect
                      value={outcomes.get(p.id)}
                      onChange={(value: Outcome) => {
                        setOutcomes(prev => {
                          const next = new Map(prev)
                          next.set(p.id, value)
                          return next
                        })
                      }}
                      allowErrors={false}
                      dense={true}
                      disabled={submitting}>
                      {outcomeOptions.map(o => (
                        <SelectOption key={o} value={o} text={getResultLabel(o, t)} />
                      ))}
                    </OutcomeSelect>
                  </PlayerRow>
                )
              })}
            </TeamGroup>
          )
        })}
      </Layout>
    </StyledDialog>
  )
}
