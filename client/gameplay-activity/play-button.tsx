import React, { useId } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { matchmakingTypeToLabel } from '../../common/matchmaking'
import { urlPath } from '../../common/urls'
import { cancelFindMatch } from '../matchmaking/action-creators'
import { ElapsedTime } from '../matchmaking/elapsed-time'
import { isMatchmakingLoading } from '../matchmaking/matchmaking-reducer'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { titleSmall } from '../styles/typography'

const PlayButtonRoot = styled.a`
  position: relative;
  width: 240px;
  height: 72px;
  margin: 0 -16px;
  padding-inline: 24px;
  z-index: 5;

  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible; /* Allow the shadow to exceed bounds */

  color: var(--theme-on-surface);
  font-size: 36px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
  text-shadow: 1px 1px rgb(from var(--color-blue10) r g b / 50%);
  text-transform: uppercase;

  &:link,
  &:visited {
    color: var(--theme-on-surface);
  }

  @media (hover: hover) {
    &:hover {
      color: var(--theme-on-surface);
      text-decoration: none;
    }

    &:focus-visible {
      outline: none;

      &:after {
        content: '';
        position: absolute;
        top: 16px;
        left: 20px;
        right: 20px;
        bottom: 16px;
        outline: 2px solid var(--theme-amber);
        border-radius: 4px;
      }
    }
  }

  &:active {
    color: var(--theme-on-surface);
    text-decoration: none;
    --menu-item-fill: var(--color-grey-blue50);

    &:before {
      content: '';
      position: absolute;
      top: 0;
      left: 20px;
      right: 20px;
      bottom: 0;
      background: var(--menu-item-fill);
    }
  }

  @media (max-width: 600px) {
    /**
      NOTE(tec27): We assume no device this small will have the ability to play games anyway.
      This does make it hard to view the current lobby list but I think that's not a huge deal? If
      it is we can probably throw that into the navigation menu somehow.
    */
    display: none;
  }
`

const PlayButtonBackground = styled.svg`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;

  && {
    overflow: visible; /* Allow the shadow to exceed bounds */
  }
`

const PlayButtonContent = styled.div`
  contain: paint;
`

const LobbyPlayContent = styled(PlayButtonContent)`
  font-size: 28px;
  text-transform: none;

  white-space: normal;
`

const MatchLoadingPlayContent = styled(PlayButtonContent)`
  font-size: 24px;
  text-transform: none;
  white-space: normal;
`

const IngamePlayContent = styled(PlayButtonContent)`
  font-size: 24px;
  text-transform: none;
  white-space: normal;
`

const MatchmakingSearchPlayContent = styled(PlayButtonContent)`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;

  font-size: 24px;
  text-transform: none;
  white-space: normal;
`

const HoverOnly = styled.div`
  display: none;
`

const SearchInProgressContentRoot = styled(MatchmakingSearchPlayContent)`
  width: 100%;
  height: 100%;

  &:hover {
    & > ${HoverOnly} {
      display: block;
    }

    & > :not(${HoverOnly}) {
      display: none;
    }
  }
`

const StyledElapsedTime = styled(ElapsedTime)`
  ${titleSmall};
`

function SearchInProgressContent() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const matchmakingSearchInfo = useAppSelector(s => s.matchmaking.searchInfo)!

  return (
    <SearchInProgressContentRoot
      onClick={event => {
        event.preventDefault()
        dispatch(cancelFindMatch())
      }}>
      <span>{matchmakingTypeToLabel(matchmakingSearchInfo.matchmakingType, t)}</span>
      <StyledElapsedTime startTimeMs={matchmakingSearchInfo.startTime} />
      <HoverOnly>{t('common.actions.cancel', 'Cancel')}</HoverOnly>
    </SearchInProgressContentRoot>
  )
}

export function PlayButton() {
  const { t } = useTranslation()
  const gradientId = useId()
  const shadowId = useId()

  const isLobbyLoading = useAppSelector(s => s.lobby.info.isLoading)
  const lobbyName = useAppSelector(s => s.lobby.info.name)
  const isMatchLoading = useAppSelector(s => isMatchmakingLoading(s.matchmaking))
  const matchmakingType = useAppSelector(s => s.matchmaking.match?.type)
  const matchmakingLaunching = useAppSelector(s => s.matchmaking.isLaunching)
  const matchmakingCountingDown = useAppSelector(s => s.matchmaking.isCountingDown)
  const matchmakingStarting = useAppSelector(s => s.matchmaking.isStarting)

  const isInActiveGame = useAppSelector(s => s.activeGame.isActive)
  const gameInfo = useAppSelector(s => s.activeGame.info)

  const inLobby = useAppSelector(s => s.lobby.inLobby)
  const matchmakingSearchInfo = useAppSelector(s => s.matchmaking.searchInfo)
  const matchmakingMatch = useAppSelector(s => s.matchmaking.match)

  let targetPath = '/play/'
  let content = <PlayButtonContent>{t('navigation.bar.play', 'Play')}</PlayButtonContent>
  if (isLobbyLoading) {
    targetPath = urlPath`/lobbies/${lobbyName}/loading-game`
    content = (
      <LobbyPlayContent>{t('navigation.leftNav.customGame', 'Custom game')}</LobbyPlayContent>
    )
  } else if (isMatchLoading) {
    content = (
      <MatchLoadingPlayContent>
        {t('navigation.leftNav.rankedGame', {
          defaultValue: 'Ranked {{matchmakingType}}',
          matchmakingType: matchmakingType ? matchmakingTypeToLabel(matchmakingType, t) : '',
        })}
      </MatchLoadingPlayContent>
    )

    if (matchmakingLaunching) {
      targetPath = '/matchmaking/countdown'
    } else if (matchmakingCountingDown) {
      targetPath = '/matchmaking/countdown'
    } else if (matchmakingStarting) {
      targetPath = '/matchmaking/game-starting'
    } else {
      // This should never really happen but it makes TS happy
      targetPath = '/matchmaking/countdown'
    }
  } else if (isInActiveGame) {
    content = (
      <IngamePlayContent>{t('navigation.bar.playIngame', 'Game in progress')}</IngamePlayContent>
    )
    if (gameInfo?.type === 'lobby') {
      targetPath = urlPath`/lobbies/${gameInfo.extra.lobby.info.name}/active-game`
    } else if (gameInfo?.type === 'matchmaking') {
      targetPath = '/matchmaking/active-game'
    }
  } else if (inLobby) {
    targetPath = urlPath`/lobbies/${lobbyName}`
    content = (
      <LobbyPlayContent>{t('navigation.leftNav.customGame', 'Custom game')}</LobbyPlayContent>
    )
  } else if (matchmakingSearchInfo) {
    targetPath = '/play/matchmaking'
    if (matchmakingMatch) {
      content = (
        <MatchmakingSearchPlayContent>
          {t('matchmaking.navEntry.matchFound', 'Match found!')}
        </MatchmakingSearchPlayContent>
      )
    } else {
      content = <SearchInProgressContent />
    }
  }

  return (
    <Link href={targetPath} asChild={true}>
      <PlayButtonRoot draggable={false}>
        <PlayButtonBackground viewBox='0 0 240 72'>
          <defs>
            <linearGradient
              id={gradientId}
              x1='52'
              y1='-20'
              x2='188'
              y2='88'
              gradientUnits='userSpaceOnUse'>
              <stop stopColor='var(--color-blue70)' />
              <stop offset='0.418214' stopColor='var(--color-blue50)' />
              <stop offset='0.68' stopColor='var(--color-blue50)' />
              <stop offset='1' stopColor='var(--color-blue60)' />
            </linearGradient>
            {/*
            NOTE(tec27): This is a level 2 elevation shadow copied out of figma, we could probably
            simplify this a bunch
          */}
            <filter
              id={shadowId}
              x='-10'
              y='0'
              width='260'
              height='80'
              filterUnits='userSpaceOnUse'
              colorInterpolationFilters='sRGB'>
              <feFlood floodOpacity='0' result='BackgroundImageFix' />
              <feColorMatrix
                in='SourceAlpha'
                type='matrix'
                values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
                result='hardAlpha'
              />
              <feMorphology
                radius='2'
                operator='dilate'
                in='SourceAlpha'
                result='effect1_dropShadow_634_1625'
              />
              <feOffset dy='2' />
              <feGaussianBlur stdDeviation='3' />
              <feColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.15 0' />
              <feBlend
                mode='normal'
                in2='BackgroundImageFix'
                result='effect1_dropShadow_634_1625'
              />
              <feColorMatrix
                in='SourceAlpha'
                type='matrix'
                values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
                result='hardAlpha'
              />
              <feOffset dy='1' />
              <feGaussianBlur stdDeviation='1' />
              <feColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.3 0' />
              <feBlend
                mode='normal'
                in2='effect1_dropShadow_634_1625'
                result='effect2_dropShadow_634_1625'
              />
              <feBlend
                mode='normal'
                in='SourceGraphic'
                in2='effect2_dropShadow_634_1625'
                result='shape'
              />
            </filter>
          </defs>
          <polygon
            points={`0,0 240,0 218,72 22,72`}
            fill={`url(#${gradientId})`}
            filter={`url(#${shadowId})`}
          />
          <path
            d={`
            M 239,0
            L 217,71
            L 23,71
            L 1,0
            L 23,71
            L 217,71
            Z
          `}
            fill='none'
            stroke='var(--color-blue90)'
            strokeWidth='2'
            strokeOpacity='0.4'
            strokeLinecap='square'
          />
        </PlayButtonBackground>
        {content}
      </PlayButtonRoot>
    </Link>
  )
}
