import React, { useEffect } from 'react'
import { Route, Switch } from 'wouter'
import { navigateToGameResults } from '../games/action-creators'
import { ResultsSubPage } from '../games/results-sub-page'
import Index from '../navigation/index'
import { replace } from '../navigation/routing'
import { useAppSelector } from '../redux-hooks'
import { usePrevious } from '../state-hooks'
import MatchmakingMatch from './matchmaking-match'
import { isMatchmakingLoading } from './matchmaking-reducer'

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
      players={players}
    />
  )
}

export default function MatchmakingView() {
  const gameIsActive = useAppSelector(s => s.activeGame.isActive)
  const gameId = useAppSelector(s => s.gameClient.gameId)
  const matchmakingIsLoading = useAppSelector(s => isMatchmakingLoading(s.matchmaking))

  const prevGameIsActive = usePrevious(gameIsActive)
  const prevGameId = usePrevious(gameId)

  useEffect(() => {
    if (!matchmakingIsLoading && !gameIsActive) {
      if (prevGameIsActive && prevGameId) {
        navigateToGameResults(prevGameId, true /* isPostGame */, ResultsSubPage.Summary, replace)
      } else {
        replace('/')
      }
    }
  }, [prevGameId, matchmakingIsLoading, gameIsActive, prevGameIsActive])

  return (
    <Switch>
      <Route path='/matchmaking/countdown' component={MatchmakingMatchHolder} />
      <Route path='/matchmaking/game-starting' component={MatchmakingMatchHolder} />
      <Route path='/matchmaking/active-game' component={MatchmakingMatchHolder} />
      <Index transitionFn={replace} />
    </Switch>
  )
}
