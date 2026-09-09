import { useTranslation } from 'react-i18next'
import styled, { keyframes } from 'styled-components'
import { Link } from 'wouter'
import BlueskyLogo from '../icons/brands/bluesky.svg?react'
import DiscordLogo from '../icons/brands/discord.svg?react'
import GithubLogo from '../icons/brands/github.svg?react'
import PatreonLogo from '../icons/brands/patreon.svg?react'
import Logo from '../logos/logo-no-bg.svg?react'
import { Tooltip } from '../material/tooltip'
import { titleSmall } from '../styles/typography'

const Root = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`

/*
 * A hover-only version of the splash logotext's transmission glitch: a stuttering two-tone
 * chromatic split in the brand's blue and amber. It never plays on its own — this logo sits on
 * surfaces players see constantly, so the interference is a small reward for poking at it rather
 * than ambient motion.
 */
const gearGlitch = keyframes`
  0%, 24.9%, 43%, 61.9%, 78%, 100% {
    transform: none;
    filter: none;
  }
  25% {
    transform: translateX(-1px);
    filter: drop-shadow(2px 0 0 rgb(from var(--color-amber60) r g b / 0.6))
      drop-shadow(-2px 0 0 rgb(from var(--color-blue80) r g b / 0.6));
  }
  34% {
    transform: translateX(1px) skewX(-1deg);
    filter: drop-shadow(-2px 0 0 rgb(from var(--color-amber60) r g b / 0.6))
      drop-shadow(2px 0 0 rgb(from var(--color-blue80) r g b / 0.6));
  }
  62% {
    transform: translateX(1px);
    filter: drop-shadow(-3px 0 0 rgb(from var(--color-amber60) r g b / 0.5))
      drop-shadow(3px 0 0 rgb(from var(--color-blue80) r g b / 0.5));
  }
  70% {
    transform: translateX(-1px);
    filter: drop-shadow(1px 0 0 rgb(from var(--color-amber60) r g b / 0.6))
      drop-shadow(-1px 0 0 rgb(from var(--color-blue80) r g b / 0.6));
  }
`

const StyledLogo = styled(Logo)`
  width: 112px;
  height: auto;
  margin-block: 8px;

  color: var(--color-grey-blue50);

  & path {
    fill: currentColor !important;
  }

  @media (prefers-reduced-motion: no-preference) {
    &:hover {
      animation: ${gearGlitch} 1.1s linear infinite;
    }
  }
`

const BottomLinksList = styled.ul`
  ${titleSmall};

  width: 100%;
  height: 40px;
  margin: 0;
  padding: 0;

  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  pointer-events: all;
  list-style: none;
  gap: 32px;

  @media screen and (max-width: 720px) {
    gap: 16px;
  }

  & > li {
    min-width: 40px;
    height: 100%;
    display: flex;
    align-items: stretch;
    justify-content: center;
  }
`

const BottomLink = styled(Link)`
  min-width: 40px;
  height: 100%;
  padding-inline: 4px;

  display: flex;
  align-items: center;
  justify-content: center;
`

const StyledDiscordLogo = styled(DiscordLogo)`
  width: auto;
  height: 18px;
  color: currentcolor;
`

const StyledGithubLogo = styled(GithubLogo)`
  width: auto;
  /** Correct for padding differences between GitHub logo and the others */
  height: 20px;
  color: currentcolor;
`

const StyledBlueskyLogo = styled(BlueskyLogo)`
  width: auto;
  height: 18px;
  color: currentcolor;
`

const StyledPatreonLogo = styled(PatreonLogo)`
  width: auto;
  height: 18px;
  color: currentcolor;
`

export function BottomLinks() {
  const { t } = useTranslation()
  return (
    <Root>
      <StyledLogo />
      <BottomLinksList>
        <li>
          <Tooltip text='Discord' position='top' tabIndex={-1}>
            <BottomLink href='https://discord.gg/S8dfMx94a4' target='_blank' rel='noopener' as='a'>
              <StyledDiscordLogo />
            </BottomLink>
          </Tooltip>
        </li>
        <li>
          <Tooltip text='Bluesky' position='top' tabIndex={-1}>
            <BottomLink
              href='https://bsky.app/profile/shieldbattery.net'
              target='_blank'
              rel='noopener'
              as='a'>
              <StyledBlueskyLogo />
            </BottomLink>
          </Tooltip>
        </li>
        <li>
          <Tooltip text='GitHub' position='top' tabIndex={-1}>
            <BottomLink
              href='https://github.com/ShieldBattery'
              target='_blank'
              rel='noopener'
              as='a'>
              <StyledGithubLogo />
            </BottomLink>
          </Tooltip>
        </li>
        <li>
          <Tooltip text='Patreon' position='top' tabIndex={-1}>
            <BottomLink href='https://patreon.com/tec27' target='_blank' rel='noopener' as='a'>
              <StyledPatreonLogo />
            </BottomLink>
          </Tooltip>
        </li>
        <li>
          <BottomLink href='/faq'>{t('landing.bottomLinks.faq', 'FAQ')}</BottomLink>
        </li>
      </BottomLinksList>
      <BottomLinksList>
        <li>
          <BottomLink href='/privacy'>
            {t('landing.bottomLinks.privacyPolicy', 'Privacy Policy')}
          </BottomLink>
        </li>
        <li>
          <BottomLink href='/terms-of-service'>
            {t('landing.bottomLinks.termsOfService', 'Terms of Service')}
          </BottomLink>
        </li>
        <li>
          <BottomLink href='/acceptable-use'>
            {t('landing.bottomLinks.acceptableUsePolicy', 'Acceptable Use Policy')}
          </BottomLink>
        </li>
      </BottomLinksList>
    </Root>
  )
}
