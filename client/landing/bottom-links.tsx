import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { body2 } from '../styles/typography'

const BottomLinksList = styled.ul`
  ${body2};

  width: 100%;
  height: 40px;

  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  pointer-events: all;
  list-style: none;
  max-width: 890px;
  margin: 8px 0px;
  padding: 8px 16px;

  @media screen and (max-width: 720px) {
    justify-content: space-around;
  }

  li:not(:first-child) {
    margin-left: 32px;

    @media screen and (max-width: 720px) {
      margin-left: 16px;
    }
  }
`

export function BottomLinks() {
  const { t } = useTranslation()
  return (
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
  )
}
