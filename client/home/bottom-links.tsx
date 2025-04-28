import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import BlueskyLogo from '../icons/brands/bluesky.svg'
import DiscordLogo from '../icons/brands/discord.svg'
import GithubLogo from '../icons/brands/github.svg'
import PatreonLogo from '../icons/brands/patreon.svg'
import Logo from '../logos/logo-no-bg.svg'
import { Tooltip } from '../material/tooltip'
import { titleSmall } from '../styles/typography'

const Root = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`

const StyledLogo = styled(Logo)`
  width: 112px;
  height: auto;
  margin-block: 8px;

  color: var(--color-grey-blue50);

  & path {
    fill: currentColor !important;
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
    align-items: center;
    justify-content: center;
  }
`

const IconLink = styled.a`
  min-width: 40px;
  height: 100%;
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
          <IconLink href='https://discord.gg/S8dfMx94a4' target='_blank' rel='noopener'>
            <Tooltip text='Discord' position='top'>
              <StyledDiscordLogo />
            </Tooltip>
          </IconLink>
        </li>
        <li>
          <IconLink
            href='https://bsky.app/profile/shieldbattery.net'
            target='_blank'
            rel='noopener'>
            <Tooltip text='Bluesky' position='top'>
              <StyledBlueskyLogo />
            </Tooltip>
          </IconLink>
        </li>
        <li>
          <IconLink href='https://github.com/ShieldBattery' target='_blank' rel='noopener'>
            <Tooltip text='GitHub' position='top'>
              <StyledGithubLogo />
            </Tooltip>
          </IconLink>
        </li>
        <li>
          <IconLink href='https://patreon.com/tec27' target='_blank' rel='noopener'>
            <Tooltip text='Patreon' position='top'>
              <StyledPatreonLogo />
            </Tooltip>
          </IconLink>
        </li>
        <li>
          <Link href='/faq'>{t('landing.bottomLinks.faq', 'FAQ')}</Link>
        </li>
      </BottomLinksList>
      <BottomLinksList>
        <li>
          <Link href='/privacy'>{t('landing.bottomLinks.privacyPolicy', 'Privacy Policy')}</Link>
        </li>
        <li>
          <Link href='/terms-of-service'>
            {t('landing.bottomLinks.termsOfService', 'Terms of Service')}
          </Link>
        </li>
        <li>
          <Link href='/acceptable-use'>
            {t('landing.bottomLinks.acceptableUsePolicy', 'Acceptable Use Policy')}
          </Link>
        </li>
      </BottomLinksList>
    </Root>
  )
}
