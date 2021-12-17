import React, { useEffect } from 'react'
import { Route, Switch } from 'wouter'
import { navigateToGameResults } from '../games/action-creators'
import { ResultsSubPage } from '../games/results-sub-page'
import Index from '../navigation/index'
import { replace } from '../navigation/routing'
import { useAppSelector } from '../redux-hooks'
import { usePrevious } from '../state-hooks'
import MatchmakingMatch from './matchmaking-match'

function MatchmakingMatchHolder() {
  const activeGame = useAppSelector(s => s.activeGame)
  const matchmaking = useAppSelector(s => s.matchmaking)

  const { isActive: hasActiveGame, info: gameInfo } = activeGame
  const { isLaunching, isCountingDown, countdownTimer, isStarting, match } = matchmaking

  const hasActiveMatchmakingGame = hasActiveGame && gameInfo?.type === 'matchmaking'
  if (!hasActiveMatchmakingGame && !match) {
    return null
  }

  const chosenMap = hasActiveMatchmakingGame ? gameInfo.extra.match.chosenMap : match!.chosenMap
  const players = hasActiveMatchmakingGame ? gameInfo.extra!.match.players : match!.players

  return (
    <MatchmakingMatch
      isLaunching={isLaunching}
      isCountingDown={isCountingDown}
      countdownTimer={countdownTimer}
      isStarting={isStarting}
      map={chosenMap}
      players={players.toJS()}
    />
  )
}

export default function MatchmakingView() {
  const activeGame = useAppSelector(s => s.activeGame)
  const gameClient = useAppSelector(s => s.gameClient)
  const matchmaking = useAppSelector(s => s.matchmaking)

  const prevIsActive = usePrevious(activeGame.isActive)
  const prevGameId = usePrevious(gameClient.gameId)

  useEffect(() => {
    if (!matchmaking.isLoading && !activeGame.isActive) {
      if (prevIsActive && prevGameId) {
        navigateToGameResults(prevGameId, true /* isPostGame */, ResultsSubPage.Summary, replace)
      }

      replace('/')
    }
  }, [matchmaking, activeGame, prevIsActive, prevGameId])

  return (
    <Switch>
      <Route path='/matchmaking/countdown' component={MatchmakingMatchHolder} />
      <Route path='/matchmaking/game-starting' component={MatchmakingMatchHolder} />
      <Route path='/matchmaking/active-game' component={MatchmakingMatchHolder} />
      <Index transitionFn={replace} />
    </Switch>
  )
}
