import { animate, frame, SpringOptions, useSpring, useTransform } from 'motion/react'
import * as m from 'motion/react-m'
import * as React from 'react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { getErrorStack } from '../../common/errors'
import { useWindowFocus } from '../dom/window-focus'
import { FileDropZone } from '../file-browser/file-drop-zone'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { elevationPlus1 } from '../material/shadows'
import { useAppDispatch } from '../redux-hooks'
import { showReplayInfo } from '../replays/action-creators'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { BodyMedium } from '../styles/typography'

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

  transform-origin: center top;

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
  damping: 360,
  stiffness: 650,
  restDelta: 0.0000001,
  restSpeed: 0.0000001,
}

function PlayButtonDisplay({
  targetPath,
  children,
}: {
  targetPath: string
  children: React.ReactNode
}) {
  const isWindowFocused = useWindowFocus()
  const [isHovered, setIsHovered] = useState(false)
  const gradientX1 = useSpring(0, buttonSpring)
  const gradientY1 = useSpring(0, buttonSpring)
  const gradientX2 = useSpring(0, buttonSpring)
  const gradientY2 = useSpring(0, buttonSpring)

  const topLeftGradientX = useTransform(() => -2 * HEIGHT + HEIGHT / 6 + gradientX1.get())
  const topLeftGradientY = useTransform(() => -HEIGHT - HEIGHT / 2 + gradientY1.get())
  const bottomRightGradientX = useTransform(() => WIDTH - HEIGHT - HEIGHT / 5 + gradientX2.get())
  const bottomRightGradientY = useTransform(() => -HEIGHT / 6 + gradientY2.get())

  const isBreathing = isWindowFocused && !isHovered
  useEffect(() => {
    if (!isBreathing) {
      return () => {}
    }

    const controllers: Array<ReturnType<typeof animate>> = []
    const duration = 21

    controllers.push(
      animate(gradientX1, [null, WIDTH / 24, -WIDTH / 8, -WIDTH / 4], {
        duration,
        repeat: Infinity,
        repeatType: 'mirror',
      }),
    )
    controllers.push(
      animate(gradientY1, [null, -HEIGHT / 2, 0, -HEIGHT / 4, HEIGHT / 6], {
        duration,
        repeat: Infinity,
        repeatType: 'mirror',
      }),
    )
    controllers.push(
      animate(gradientX2, [null, -WIDTH / 16, WIDTH / 5, -WIDTH / 14, WIDTH / 3], {
        duration: duration + 7,
        repeat: Infinity,
        repeatType: 'mirror',
      }),
    )
    controllers.push(
      animate(gradientY2, [null, -HEIGHT + HEIGHT / 3, 0, -HEIGHT + HEIGHT / 5, HEIGHT / 8], {
        duration: duration + 7,
        repeat: Infinity,
        repeatType: 'mirror',
      }),
    )

    return () => {
      for (const controller of controllers) {
        controller.stop()
      }
    }
  }, [isBreathing, gradientX1, gradientY1, gradientX2, gradientY2])

  return (
    <Link href={targetPath} asChild={true}>
      <Root
        draggable={false}
        animate={isBreathing ? 'animate' : undefined}
        whileHover='hover'
        whileTap='tap'
        variants={{
          tap: {
            scale: 0.975,
            transition: {
              type: 'spring',
              duration: 0.15,
            },
          },
        }}
        onMouseEnter={() => {
          setIsHovered(true)
        }}
        onMouseLeave={() => {
          setIsHovered(false)
        }}
        onMouseMove={(event: React.MouseEvent) => {
          const { clientX, currentTarget } = event
          frame.read(() => {
            const rect = currentTarget.getBoundingClientRect()
            const halfWidth = rect.width / 2
            const halfHeight = rect.height / 2
            const pointerX = clientX - rect.left
            const pointerY = event.clientY - rect.top
            // 0 (left edge) to 1 (right edge)
            const xNorm = Math.max(0, Math.min(1, pointerX / rect.width))

            const minY = -halfHeight
            const maxY = halfHeight
            const yValue = minY + (maxY - minY) * (1 - xNorm)

            const fromCenterX = Math.max(
              Math.min(pointerX - halfWidth, halfWidth * 0.6),
              -halfWidth * 0.6,
            )
            const fromCenterY = Math.max(
              Math.min(pointerY - halfHeight, halfHeight * 0.4),
              -halfHeight * 0.4,
            )

            gradientX1.set(fromCenterX - 0.4 * halfWidth)
            gradientY1.set(yValue + fromCenterY)
            gradientX2.set(fromCenterX + 0.4 * halfWidth)
            gradientY2.set(-yValue + fromCenterY)
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
                scale: 0.7,
              } as any
            }
            variants={{
              animate: {
                scale: [null, 0.7, 1],
                transition: {
                  type: 'easeInOut',
                  duration: 21,
                  repeat: Infinity,
                  repeatType: 'reverse',
                },
              },
              hover: {
                scale: 1,
                transition: {
                  type: 'spring',
                  ...buttonSpring,
                },
              },
            }}
          />
          <GradientCircle
            style={
              {
                '--_color': 'rgb(from var(--color-blue70) r g b / 0.6)',
                width: HEIGHT * 3,
                x: bottomRightGradientX,
                y: bottomRightGradientY,
                scale: 1,
              } as any
            }
            variants={{
              animate: {
                scale: [null, 1, 0.7],
                transition: {
                  type: 'easeInOut',
                  duration: 28,
                  repeat: Infinity,
                  repeatType: 'reverse',
                },
              },
              hover: {
                scale: 1,
                transition: {
                  type: 'spring',
                  ...buttonSpring,
                },
              },
            }}
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

  return (
    <PlayButtonDisplay targetPath={'/play/'}>
      {
        <PlayButtonContent>
          <PlayText text={t('navigation.bar.play', 'Play')} />
        </PlayButtonContent>
      }
      {IS_ELECTRON ? <FileDrop /> : null}
    </PlayButtonDisplay>
  )
}
