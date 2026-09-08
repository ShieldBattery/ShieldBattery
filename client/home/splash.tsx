import * as m from 'motion/react-m'
import { Trans, useTranslation } from 'react-i18next'
import styled, { keyframes } from 'styled-components'
import { useResizeObserver } from '../dom/dimension-hooks'
import { navigateToDownload } from '../download/download-navigate'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton, Label } from '../material/button'
import { makePublicAssetUrl } from '../network/server-url'
import { CenteredContentContainer } from '../styles/centered-container'
import {
  bodyMedium,
  headlineLarge,
  headlineMedium,
  headlineSmall,
  titleMedium,
} from '../styles/typography'
import { GameCounter } from './game-counter'

const Root = styled(CenteredContentContainer)`
  position: relative;
  height: auto;
  padding-block: 24px;

  background: linear-gradient(
    to bottom,
    var(--color-blue20),
    rgb(from var(--color-blue20) r g b / 0)
  );

  contain: content;
  overflow-y: hidden;

  display: grid;
  grid-template-rows: 1fr auto;

  container-type: inline-size;
`

const ContentArea = styled.div`
  position: relative;
  width: 100%;
  min-height: 600px;
`

const Monitor = styled.img`
  position: absolute;
  width: 548px;
  height: auto;
  right: 0;

  @container (max-width: 1119px) {
    width: 400px;
    top: 36px;
    right: -24px;
  }

  @container (max-width: 999px) {
    width: 320px;
    top: 52px;
    right: -48px;
  }

  @container (max-width: 860px) {
    display: none;
  }
`

const Logo = styled.img`
  width: 172px;
  height: auto;
`

/*
 * The logotext plays a brief transmission-glitch burst every several seconds: the base image gets
 * a two-tone chromatic split (the brand's blue and amber standing in for RGB fringing) while two
 * displaced horizontal slices tear out of it. Each cycle idles for ~93% of its duration, so the
 * effect reads as a rare flicker of interference rather than a looping animation. Hovering the
 * logotext shortens the cycle so the burst repeats quickly.
 */

const glitchSplit = keyframes`
  0%, 92.9%, 98.6%, 100% {
    transform: none;
    filter: none;
  }
  93% {
    transform: translateX(-2px);
    filter: drop-shadow(3px 0 0 rgb(from var(--color-amber60) r g b / 0.7))
      drop-shadow(-3px 0 0 rgb(from var(--color-blue80) r g b / 0.7));
  }
  94.4% {
    transform: translateX(2px) skewX(-1.5deg);
    filter: drop-shadow(-4px 0 0 rgb(from var(--color-amber60) r g b / 0.7))
      drop-shadow(4px 0 0 rgb(from var(--color-blue80) r g b / 0.7));
  }
  96% {
    transform: translateX(-1px);
    filter: drop-shadow(2px 0 0 rgb(from var(--color-amber60) r g b / 0.5))
      drop-shadow(-2px 0 0 rgb(from var(--color-blue80) r g b / 0.5));
  }
`

const glitchSliceTop = keyframes`
  0%, 92.9%, 98.2%, 100% {
    opacity: 0;
    clip-path: inset(18% 0 64% 0);
    transform: none;
  }
  93% {
    opacity: 1;
    clip-path: inset(18% 0 64% 0);
    transform: translateX(7px);
  }
  94.6% {
    clip-path: inset(8% 0 74% 0);
    transform: translateX(-5px);
  }
  96.4% {
    opacity: 1;
    clip-path: inset(26% 0 58% 0);
    transform: translateX(4px);
  }
`

const glitchSliceBottom = keyframes`
  0%, 93.3%, 98.5%, 100% {
    opacity: 0;
    clip-path: inset(62% 0 16% 0);
    transform: none;
  }
  93.4% {
    opacity: 1;
    clip-path: inset(62% 0 16% 0);
    transform: translateX(-6px);
  }
  95.2% {
    clip-path: inset(70% 0 6% 0);
    transform: translateX(5px);
  }
  97% {
    opacity: 1;
    clip-path: inset(54% 0 30% 0);
    transform: translateX(-3px);
  }
`

const LogoText = styled.img`
  display: block;
  width: auto;
  height: 56px;
`

const GlitchSlice = styled.img`
  position: absolute;
  top: 0;
  left: 0;
  height: 56px;
  width: auto;

  opacity: 0;
  pointer-events: none;
`

const GlitchSliceTop = styled(GlitchSlice)`
  filter: drop-shadow(-2px 0 0 rgb(from var(--color-blue80) r g b / 0.8));
`

const GlitchSliceBottom = styled(GlitchSlice)`
  filter: drop-shadow(2px 0 0 rgb(from var(--color-amber60) r g b / 0.8));
`

const LogoTextGlitch = styled.div`
  position: relative;

  @media (prefers-reduced-motion: no-preference) {
    & ${LogoText} {
      animation: ${glitchSplit} 7s linear infinite;
    }
    & ${GlitchSliceTop} {
      animation: ${glitchSliceTop} 7s linear infinite;
    }
    & ${GlitchSliceBottom} {
      animation: ${glitchSliceBottom} 7s linear infinite;
    }

    &:hover ${LogoText}, &:hover ${GlitchSliceTop}, &:hover ${GlitchSliceBottom} {
      animation-duration: 1.4s;
    }
  }
`

const Subtitle = styled.div`
  ${headlineSmall};
`

const LogoTextAndSubtitle = styled.div`
  padding-top: 4px;

  display: flex;
  flex-direction: column;

  align-items: flex-start;
  gap: 8px;

  @container (max-width: 640px) {
    align-items: center;
    text-align: center;
  }
`

const LogoLayout = styled.div`
  max-width: 560px;
  height: calc(172px + 64px);
  padding-top: 64px;

  display: flex;
  align-items: flex-start;
  gap: 40px;

  contain: content;

  @container (max-width: 860px) {
    margin-inline: auto;
    align-items: center;
  }

  @container (max-width: 640px) {
    height: auto;
    flex-direction: column;
  }
`

const GradientCircle = styled(m.div)`
  position: absolute;
  aspect-ratio: 1;
  width: 200%;

  background-color: var(--_color, rgb(from var(--color-blue40) r g b / 0.12));
  border-radius: 9999px;

  @media (max-width: 1599px) {
    transform: scale(1.1);
  }

  @media (max-width: 1359px) {
    transform: scale(1.2);
  }

  @media (max-width: 999px) {
    transform: scale(1.3);
  }

  @media (max-width: 640px) {
    transform: scale(1.35);
  }
`

const Blurb = styled.div`
  ${titleMedium};
  max-width: 480px;
  /** Align with left edge of logotext/subtitle */
  margin-left: 212px;
  margin-top: -16px;

  contain: content;
  text-shadow: 0 0px 4px rgb(from var(--color-grey-blue10) r g b / 0.8);

  @container (max-width: 860px) {
    max-width: 556px;
    margin-inline: auto;
    margin-top: 32px;
  }
`

const BottomContent = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 40px;

  margin-block: 56px 40px;
`

const DownloadButton = styled(FilledButton)`
  min-width: 240px;
  height: 64px;

  & ${Label} {
    ${headlineMedium};
  }
`

const StyledGameCounter = styled(GameCounter)`
  ${headlineLarge};
  display: flex;
  align-items: flex-end;
  gap: 8px;

  & > .games-played {
    padding-bottom: 2px;
  }
`

const DisclaimerText = styled.div`
  ${bodyMedium};

  width: 100%;
  max-width: 960px;
  margin: 0 auto;

  color: var(--theme-on-surface-variant);
`

export function SplashContent() {
  const { t } = useTranslation()
  const [resizeObserverRef, observerEntry] = useResizeObserver({ box: 'border-box' })

  const dimensions = observerEntry?.borderBoxSize?.[0]
  const baseSize = Math.max(dimensions?.inlineSize ?? 1360, dimensions?.blockSize ?? 800)
  const scale = baseSize / 1360

  const monitorImage = makePublicAssetUrl('images/splash-monitor.png')
  const logoImage = makePublicAssetUrl('images/logo-no-bg-large.svg')
  const logoText = makePublicAssetUrl('images/logotext-white-56px.svg')

  return (
    <Root ref={resizeObserverRef}>
      <GradientCircle
        style={
          {
            '--_color': 'rgb(from var(--color-blue30) r g b / 0.12)',
            width: 1200 * scale,
            left: -580 * scale,
            top: -200 * scale,
          } as any
        }
      />
      <GradientCircle
        style={{
          width: 1500 * scale,
          right: -460 * scale,
          top: -1000 * scale,
        }}
      />
      <GradientCircle
        style={{
          width: 1300 * scale,
          left: -100 * scale,
          bottom: -1050 * scale,
        }}
      />
      <GradientCircle
        style={{
          width: 1400 * scale,
          right: -700 * scale,
          bottom: -900 * scale,
        }}
      />
      <ContentArea>
        <Monitor src={monitorImage} alt='' />
        <LogoLayout>
          <Logo src={logoImage} alt='' />
          <LogoTextAndSubtitle>
            <LogoTextGlitch>
              <LogoText src={logoText} alt='ShieldBattery' />
              <GlitchSliceTop src={logoText} alt='' aria-hidden={true} />
              <GlitchSliceBottom src={logoText} alt='' aria-hidden={true} />
            </LogoTextGlitch>
            <Subtitle>
              {t('landing.splash.subtitle', 'The premier StarCraft 1 community platform')}
            </Subtitle>
          </LogoTextAndSubtitle>
        </LogoLayout>
        <Blurb>
          <Trans t={t} i18nKey='landing.splash.blurb'>
            ShieldBattery is a community server that supports official StarCraft: Remastered
            clients. Download our launcher to get access to 1v1 and team matchmaking, improved
            netcode, fast replay launching, and more!
          </Trans>
        </Blurb>

        <BottomContent>
          <DownloadButton
            onClick={navigateToDownload}
            iconStart={<MaterialIcon icon='download' size={32} />}
            label={t('common.actions.download', 'Download')}
          />
          <StyledGameCounter height={44} />
        </BottomContent>
      </ContentArea>
      <DisclaimerText>
        <Trans t={t} i18nKey='landing.splash.disclaimerText'>
          StarCraft is a registered trademark of Blizzard Entertainment, Inc. ShieldBattery is
          developed solely by members of the community, unaffiliated with Blizzard, and is not
          officially endorsed or supported by Blizzard.
        </Trans>
      </DisclaimerText>
    </Root>
  )
}
