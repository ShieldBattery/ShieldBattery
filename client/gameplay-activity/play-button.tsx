import {
  animate,
  frame,
  SpringOptions,
  useMotionValue,
  useSpring,
  useTransform,
} from 'motion/react'
import * as m from 'motion/react-m'
import React, { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { getErrorStack } from '../../common/errors'
import { matchmakingTypeToLabel } from '../../common/matchmaking'
import { urlPath } from '../../common/urls'
import { useWindowFocus } from '../dom/window-focus'
import { FileDropZone } from '../file-browser/file-drop-zone'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { cancelFindMatch } from '../matchmaking/action-creators'
import { ElapsedTime } from '../matchmaking/elapsed-time'
import { isMatchmakingLoading } from '../matchmaking/matchmaking-reducer'
import { elevationPlus1 } from '../material/shadows'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { showReplayInfo } from '../replays/action-creators'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { BodyMedium, titleSmall } from '../styles/typography'

const WIDTH = 240
const HEIGHT = 72

const Root = styled(m.a)`
  position: relative;
  width: ${WIDTH}px;
  height: ${HEIGHT}px;
  margin: 0 -16px;
  padding-inline: 24px;
  z-index: 5;

  display: flex;
  align-items: center;
  justify-content: center;

  filter: drop-shadow(0px 2px 3px rgba(0, 0, 0, 0.15)) drop-shadow(0px 1px 1px rgba(0, 0, 0, 0.3))
    drop-shadow(0px 0px 1px rgb(from var(--color-blue80) r g b / 0.32));
  overflow: visible;

  color: var(--theme-on-surface);
  font-size: 36px;
  font-variation-settings: 'wght' 870;
  letter-spacing: 1.6px;
  line-height: 1;
  text-align: center;
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
        top: 8px;
        left: 22px;
        right: 22px;
        bottom: 12px;
        outline: 3px solid var(--theme-amber);
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

const PlayButtonBackground = styled(m.div)`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  clip-path: polygon(0% 0%, 100% 0%, 90.83% 100%, 9.17% 100%);

  /** This is the border color */
  background: var(--color-blue80);
`

const PlayButtonBackgroundFill = styled.div`
  position: absolute;
  /** Whatever space we leave here will be the border */
  left: 1px;
  right: 1px;
  top: 0;
  bottom: 1px;
  /** Inherit the trapezoid shape */
  clip-path: inherit;

  background: linear-gradient(
    145deg,
    var(--color-blue50),
    20%,
    var(--color-blue30),
    80%,
    var(--color-blue50)
  );

  z-index: 1;
`

const GradientCircle = styled(m.div)`
  position: absolute;
  aspect-ratio: 1;
  width: 200%;

  background-color: var(--_color, rgb(from var(--color-blue70) r g b / 0.8));
  border-radius: 9999px;
  filter: blur(24px);
  transform-origin: center;
  will-change: transform;

  z-index: 2;
`

const buttonSpring: SpringOptions = {
  mass: 24,
  damping: 350,
  stiffness: 650,
  restDelta: 0.00001,
  restSpeed: 0.00001,
}

function PlayButtonDisplay({
  targetPath,
  children,
  fastBreathing = false,
}: {
  targetPath: string
  children: React.ReactNode
  fastBreathing?: boolean
}) {
  const isWindowFocused = useWindowFocus()
  const [isBreathing, setIsBreathing] = useState(true)
  const breatheScale = useMotionValue(0)
  const breatheScale2 = useMotionValue(0)
  const gradientX = useSpring(0, buttonSpring)
  const gradientY = useSpring(0, buttonSpring)
  const gradientX2 = useSpring(0, buttonSpring)
  const gradientY2 = useSpring(0, buttonSpring)

  useEffect(() => {
    if (!isWindowFocused) {
      return () => {}
    }

    const controllers: Array<ReturnType<typeof animate>> = []
    if (!isBreathing) {
      controllers.push(
        animate(breatheScale, 1, {
          duration: 1.5,
          ease: 'easeInOut',
        }),
      )
      controllers.push(
        animate(breatheScale2, 1, {
          duration: 1.5,
          ease: 'easeInOut',
        }),
      )
    } else {
      const duration = fastBreathing ? 8 : 21
      controllers.push(
        animate(breatheScale, [null, 1, 0.7], {
          duration,
          repeat: Infinity,
          repeatType: 'mirror',
          ease: 'easeInOut',
        }),
      )
      controllers.push(
        animate(breatheScale2, [null, 0.7, 1], {
          duration: duration + 1,
          repeat: Infinity,
          repeatType: 'mirror',
          ease: 'easeInOut',
        }),
      )

      controllers.push(
        animate(gradientX, [null, WIDTH / 24, -WIDTH / 10, -WIDTH / 6], {
          duration,
          repeat: Infinity,
          repeatType: 'mirror',
        }),
      )
      controllers.push(
        animate(gradientY, [null, -HEIGHT / 3, 0, -HEIGHT / 6, HEIGHT / 6], {
          duration,
          repeat: Infinity,
          repeatType: 'mirror',
        }),
      )
      controllers.push(
        animate(gradientX2, [null, -WIDTH / 12, WIDTH / 5, -WIDTH / 16, WIDTH / 8], {
          duration: duration + 1,
          repeat: Infinity,
          repeatType: 'mirror',
        }),
      )
      controllers.push(
        animate(gradientY2, [null, -HEIGHT + HEIGHT / 3, 0, -HEIGHT + HEIGHT / 5, HEIGHT / 8], {
          duration: duration + 1,
          repeat: Infinity,
          repeatType: 'mirror',
        }),
      )
    }

    return () => {
      for (const controller of controllers) {
        controller.stop()
      }
    }
  }, [
    isWindowFocused,
    isBreathing,
    breatheScale,
    gradientX,
    gradientY,
    fastBreathing,
    breatheScale2,
    gradientX2,
    gradientY2,
  ])

  const topLeftGradientX = useTransform(() => -2 * HEIGHT + HEIGHT / 6 + gradientX.get())
  const topLeftGradientY = useTransform(() => -HEIGHT - HEIGHT / 2 + gradientY.get())
  const bottomRightGradientX = useTransform(() => WIDTH - HEIGHT - HEIGHT / 5 + gradientX2.get())
  const bottomRightGradientY = useTransform(() => -HEIGHT / 6 + gradientY2.get())

  return (
    <Link href={targetPath} asChild={true}>
      <Root
        draggable={false}
        onMouseEnter={() => {
          setIsBreathing(false)
        }}
        onMouseLeave={() => {
          setIsBreathing(true)
        }}
        onMouseMove={(event: React.MouseEvent) => {
          const { clientX, clientY, currentTarget } = event
          frame.read(() => {
            const rect = currentTarget.getBoundingClientRect()
            const halfWidth = rect.width / 2
            const halfHeight = rect.height / 2
            const fromCenterX = Math.max(
              Math.min(clientX - rect.left - halfWidth, halfWidth * 0.6),
              -halfWidth * 0.6,
            )
            const fromCenterY = Math.max(
              Math.min(clientY - rect.top - rect.height / 2, halfHeight * 0.6),
              -halfHeight * 0.6,
            )
            gradientX.set(fromCenterX - 0.4 * halfWidth)
            gradientY.set(fromCenterY - 0.4 * halfHeight)
            gradientX2.set(fromCenterX + 0.4 * halfWidth)
            gradientY2.set(fromCenterY + 0.4 * halfHeight)
          })
        }}>
        <PlayButtonBackground>
          <PlayButtonBackgroundFill />
          <GradientCircle
            style={
              {
                '--_color': 'rgb(from var(--color-blue80) r g b / 0.6)',
                width: HEIGHT * 3,
                x: topLeftGradientX,
                y: topLeftGradientY,
                scale: breatheScale,
              } as any
            }
          />
          <GradientCircle
            style={
              {
                '--_color': 'rgb(from var(--color-blue70) r g b / 0.6)',
                width: HEIGHT * 3,
                x: bottomRightGradientX,
                y: bottomRightGradientY,
                scale: breatheScale2,
              } as any
            }
          />
        </PlayButtonBackground>
        {children}
      </Root>
    </Link>
  )
}

/**
 * SVG-rendered text that has an outline that can be translucent without having problems with
 * overlapping strokes. Text will be vertically and horizontally centered within the element.
 */
function OutlinedText({
  className,
  strokeWidth = 'var(--_stroke-width)',
  strokeColor = 'var(--_stroke-color)',
  strokeOpacity = 'var(--_stroke-opacity)',
  text,
}: {
  className?: string
  strokeWidth?: string | number
  strokeColor?: string
  strokeOpacity?: string | number
  text: string
}) {
  const filterId = useId()
  const maskId = useId()

  return (
    <svg className={className}>
      <defs>
        <mask id={maskId}>
          <text
            x={'50%'}
            y={'50%'}
            textAnchor={'middle'}
            dominantBaseline={'middle'}
            fill='none'
            strokeWidth={strokeWidth}
            strokeLinecap='round'
            strokeLinejoin='round'
            stroke='#ffffff'
            filter={`url(#${filterId})`}>
            {text}
          </text>
        </mask>
      </defs>

      <rect
        x={0}
        y={0}
        width={'100%'}
        height={'100%'}
        fill={strokeColor}
        opacity={strokeOpacity}
        mask={`url(#${maskId})`}
      />
      <text x={'50%'} y={'50%'} textAnchor={'middle'} dominantBaseline={'middle'}>
        {text}
      </text>
    </svg>
  )
}

const PlayButtonContent = styled.div`
  width: 100%;
  height: 100%;
  z-index: 1;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
`

const PlayText = styled(OutlinedText)`
  width: 100%;
  height: 100%;

  --_stroke-width: 10px;
  --_stroke-color: var(--color-blue10);
  --_stroke-opacity: 0.5;
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

const StyledFileDropZone = styled(FileDropZone)`
  position: absolute;
  inset: 0;
  z-index: 1;
`

const FileDropContents = styled.div`
  ${elevationPlus1};
  width: 100%;
  height: 100%;
  padding: 8px;

  pointer-events: none;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;

  background-color: var(--theme-primary-container);
  border-radius: 0 0 12px 12px;
  color: var(--theme-on-primary-container);
  font-variation-settings: normal;
  text-transform: none;
`

function FileDrop() {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()

  return (
    <StyledFileDropZone
      extensions={['rep']}
      onFilesDropped={files => {
        // TODO(tec27): Support multiple replay files being dropped at once: create a playlist/watch
        // them in succession
        const file = files[0]
        try {
          const path = window.SHIELDBATTERY_ELECTRON_API?.webUtils.getPathForFile(file)
          if (!path) {
            throw new Error('No path found for replay file')
          }
          dispatch(showReplayInfo(path))
        } catch (e) {
          snackbarController.showSnackbar(
            t('replays.fileDropError', `There was a problem opening the replay file`),
          )
          logger.error(`Error getting path for replay file: ${getErrorStack(e)}`)
        }
      }}>
      <FileDropContents>
        <MaterialIcon icon='file_open' size={24} />
        <BodyMedium>
          {t('replays.fileDropText', 'Drop replays here to watch them with ShieldBattery.')}
        </BodyMedium>
      </FileDropContents>
    </StyledFileDropZone>
  )
}

export function PlayButton() {
  const { t } = useTranslation()

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
  let fastBreathing = false
  let content = (
    <PlayButtonContent>
      <PlayText text={t('navigation.bar.play', 'Play')} />
    </PlayButtonContent>
  )
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
    fastBreathing = true
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
    <PlayButtonDisplay targetPath={targetPath} fastBreathing={fastBreathing}>
      {content}
      {IS_ELECTRON ? <FileDrop /> : null}
    </PlayButtonDisplay>
  )
}
