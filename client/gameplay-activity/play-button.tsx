import * as React from 'react'
import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { keyframes } from 'styled-components'
import { Link } from 'wouter'
import { getErrorStack } from '../../common/errors'
import { audioManager, AvailableSound } from '../audio/audio-manager'
import { useWindowFocus } from '../dom/window-focus'
import { FileDropZone } from '../file-browser/file-drop-zone'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { elevationPlus1 } from '../material/shadows'
import { useAppDispatch } from '../redux-hooks'
import { showReplayInfo } from '../replays/action-creators'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { BodyMedium, sofiaSans } from '../styles/typography'
import psiFrost from './psi-frost.svg?no-inline'

const WIDTH = 240
const HEIGHT = 72

const psiBreath = keyframes`
  0%, 100% {
    scale: 0.97;
    opacity: var(--_psi-rest-opacity);
  }
  45% {
    scale: 1.03;
    opacity: var(--_psi-crest-opacity);
  }
`

const psiFlow = keyframes`
  0% {
    transform: translate(-48px, 8px) rotate(-4deg) scale(0.86, 1.04);
  }
  55% {
    transform: translate(12px, -2px) rotate(0deg) scale(1.12, 0.97);
  }
  100% {
    transform: translate(52px, -8px) rotate(4deg) scale(0.94, 1.02);
  }
`

const psiCounterflow = keyframes`
  0% {
    transform: translate(44px, -6px) rotate(176deg) scale(1.1, 0.98);
  }
  55% {
    transform: translate(-10px, 2px) rotate(180deg) scale(0.88, 1.04);
  }
  100% {
    transform: translate(-48px, 8px) rotate(184deg) scale(1.06, 1);
  }
`

const EnergyField = styled.div<{ $reverse?: boolean }>`
  position: absolute;
  inset: 0;
  pointer-events: none;
  transition-property: transform, scale;
  transition-duration: ${props => (props.$reverse ? '2100ms' : '1500ms')};
  transition-timing-function: cubic-bezier(0.25, 0.35, 0.25, 1);

  /* The texture is static; the browser composites its movement between pointer updates. */
  &::before {
    --_psi-rest-opacity: ${props => (props.$reverse ? 0.4 : 0.6)};
    --_psi-crest-opacity: ${props => (props.$reverse ? 0.65 : 0.85)};

    content: '';
    position: absolute;
    /* The light enters from opposite corners, leaving the label clear without a stationary mask. */
    width: 320px;
    height: 176px;
    left: ${props => (props.$reverse ? '54px' : '-136px')};
    top: ${props => (props.$reverse ? '8px' : '-96px')};
    background:
      radial-gradient(
        ellipse closest-side at 35% 50%,
        rgb(from var(--color-blue95) r g b / 0.5),
        transparent 100%
      ),
      url('${psiFrost}') center / contain no-repeat;
    opacity: ${props => (props.$reverse ? 0.45 : 0.65)};
    transform: ${props => (props.$reverse ? 'rotate(180deg)' : 'none')};
    /* Both layers breathe together while their slower currents drift independently. */
    animation-name: ${props => (props.$reverse ? psiCounterflow : psiFlow)}, ${psiBreath};
    animation-duration: ${props => (props.$reverse ? '36s' : '26s')}, 11s;
    animation-delay: ${props => (props.$reverse ? '-18s' : '-8s')}, -2.5s;
    animation-play-state: var(--_psi-play-state);
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
    animation-direction: alternate, normal;
  }

  @media (prefers-reduced-motion: reduce) {
    transform: none !important;
    scale: none !important;
    transition: none;

    &::before {
      animation: none;
    }
  }
`

const CrystalLight = styled.div`
  position: absolute;
  inset: 0;
  opacity: 0.85;
  transition: opacity 250ms ease-out;
`

const Root = styled.a<{ $active: boolean }>`
  --_psi-play-state: ${props => (props.$active ? 'running' : 'paused')};

  position: relative;
  width: ${WIDTH}px;
  height: ${HEIGHT}px;
  margin: 0 -16px;
  padding-inline: 24px;
  z-index: 5;

  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;

  ${sofiaSans};
  color: var(--theme-on-surface);
  font-size: 36px;
  font-variation-settings: 'wght' 870;
  letter-spacing: 1.6px;
  line-height: 1;
  text-align: center;
  text-transform: uppercase;

  transform-origin: center top;
  transition: transform 150ms ease-out;

  &:link,
  &:visited {
    color: var(--theme-on-surface);
  }

  &:focus-visible {
    outline: none;

    &::after {
      content: '';
      position: absolute;
      top: 8px;
      left: 22px;
      right: 22px;
      bottom: 12px;
      outline: 3px solid var(--theme-amber);
      border-radius: 4px;
      pointer-events: none;
    }

    ${CrystalLight} {
      opacity: 1;
    }

    ${EnergyField} {
      scale: 1.14 1.02;
    }
  }

  @media (hover: hover) {
    &:hover {
      color: var(--theme-on-surface);
      text-decoration: none;

      ${CrystalLight} {
        opacity: 1;
      }

      ${EnergyField} {
        scale: 1.14 1.02;
      }
    }
  }

  &:active {
    color: var(--theme-on-surface);
    text-decoration: none;
    transform: scale(0.975);
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;

    &:active {
      transform: none;
    }
  }

  @media (max-width: 600px) {
    /**
      NOTE(tec27): We assume no device this small will have the ability to play games anyway.
      This does make it hard to view the current lobby list but I think that's not a huge deal? If
      it is we can probably throw that into the navigation menu somehow.
    */
    --_psi-play-state: paused;
    display: none;
  }
`

const PlayButtonBackground = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  clip-path: polygon(0% 0%, 100% 0%, 90.83% 100%, 9.17% 100%);
  background: linear-gradient(
    110deg,
    var(--color-blue70),
    var(--color-blue95),
    var(--color-blue70)
  );
`

const PlayButtonBackgroundFill = styled.div`
  position: absolute;
  left: 1px;
  right: 1px;
  top: 0;
  bottom: 1px;
  overflow: hidden;
  clip-path: inherit;
  background:
    linear-gradient(
      110deg,
      rgb(from var(--color-blue95) r g b / 0.16),
      transparent 24%,
      transparent 78%,
      rgb(from var(--color-blue80) r g b / 0.12)
    ),
    linear-gradient(145deg, var(--color-blue50), 20%, var(--color-blue30), 80%, var(--color-blue50));
`

function PlayButtonDisplay({
  targetPath,
  children,
}: {
  targetPath: string
  children: React.ReactNode
}) {
  const isWindowFocused = useWindowFocus()
  const energyRef = useRef<HTMLDivElement>(null)
  const counterflowRef = useRef<HTMLDivElement>(null)

  return (
    <Link href={targetPath} asChild={true}>
      <Root
        data-testid='nav-play-button'
        draggable={false}
        $active={isWindowFocused}
        onMouseMove={event => {
          const rect = event.currentTarget.getBoundingClientRect()
          const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
          const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
          const offsetX = x / rect.width - 0.5
          const offsetY = y / rect.height - 0.5
          const trackingX = Math.max(
            -rect.width * 0.3,
            Math.min(rect.width * 0.3, x - rect.width / 2),
          )
          // The farther current travels less and settles more slowly, giving the light depth.
          if (energyRef.current) {
            energyRef.current.style.transform = `translate(${trackingX * 0.9}px, ${offsetY * 24 - offsetX * 24}px)`
          }
          if (counterflowRef.current) {
            counterflowRef.current.style.transform = `translate(${trackingX * 0.5}px, ${offsetY * -10 + offsetX * 12}px)`
          }
        }}
        onMouseLeave={() => {
          energyRef.current?.style.removeProperty('transform')
          counterflowRef.current?.style.removeProperty('transform')
        }}
        onMouseDown={() => {
          audioManager.playSound(AvailableSound.PlayButton)
        }}>
        <PlayButtonBackground aria-hidden={true}>
          <PlayButtonBackgroundFill>
            <CrystalLight>
              <EnergyField ref={energyRef} />
              <EnergyField ref={counterflowRef} $reverse={true} />
            </CrystalLight>
          </PlayButtonBackgroundFill>
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
