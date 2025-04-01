import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import BlueskyLogo from '../icons/brands/bluesky.svg'
import GithubLogo from '../icons/brands/github.svg'
import Logo from '../logos/logo-no-bg.svg'
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
`

const IconLink = styled.a`
  display: flex;
  align-items: center;
  gap: 8px;
`

const StyledGithubLogo = styled(GithubLogo)`
  width: auto;
  height: 18px;
  color: currentcolor;
`

const StyledBlueskyLogo = styled(BlueskyLogo)`
  width: auto;
  /** The Bluesky icon doesn't have built-in padding so it appears a bit larger. */
  height: 16px;
  color: currentcolor;
`

const HideWhenSmall = styled.span`
  @media screen and (max-width: 720px) {
    display: none;
  }
`

export function BottomLinks() {
  const { t } = useTranslation()
  return (
    <Root>
      <StyledLogo />
      <BottomLinksList>
        <li>
          <IconLink
            href='https://bsky.app/profile/shieldbattery.net'
            target='_blank'
            rel='noopener'>
            <StyledBlueskyLogo />
            <HideWhenSmall>Bluesky</HideWhenSmall>
          </IconLink>
        </li>
        <li>
          <IconLink href='https://github.com/ShieldBattery' target='_blank' rel='noopener'>
            <StyledGithubLogo />
            <HideWhenSmall>GitHub</HideWhenSmall>
          </IconLink>
        </li>
        <li>
          <a href='https://patreon.com/tec27' target='_blank' rel='noopener'>
            Patreon
          </a>
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
