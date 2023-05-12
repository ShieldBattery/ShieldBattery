import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { LANGUAGE_SUPPORT } from '../../common/flags'
import {
  ALL_TRANSLATION_LANGUAGES,
  TranslationLanguage,
  translationLanguageToLabel,
} from '../../common/i18n'
import GithubLogo from '../icons/brands/github.svg'
import TwitterLogo from '../icons/brands/twitter.svg'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { IconButton } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, useAnchorPosition, usePopoverController } from '../material/popover'
import { Tooltip } from '../material/tooltip'
import { useAppDispatch } from '../redux-hooks'
import { openSnackbar } from '../snackbars/action-creators'
import { useStableCallback } from '../state-hooks'
import { amberA400 } from '../styles/colors'
import { body2 } from '../styles/typography'

const TopLinksList = styled.ul`
  ${body2};

  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  pointer-events: all;
  list-style: none;
  width: 100%;
  max-width: 890px;
  margin: 8px 0px;
  padding: 0px 16px;
  height: 22px;

  @media screen and (max-width: 720px) {
    justify-content: space-around;
  }

  li:not(:first-child) {
    margin-left: 32px;

    @media screen and (max-width: 720px) {
      margin-left: 16px;
    }

    @media screen and (max-width: 500px) {
      margin-left: 8px;
    }
  }
`

const IconLink = styled.a`
  display: flex;
  align-items: center;
`

const StyledGithubLogo = styled(GithubLogo)`
  width: auto;
  height: 18px;
  color: ${amberA400};
  margin-right: 8px;
`

const StyledTwitterLogo = styled(TwitterLogo)`
  width: auto;
  /** The Twitter icon doesn't have built-in padding so it appears a bit larger. */
  height: 16px;
  color: ${amberA400};
  margin-right: 8px;
`

const LanguageIcon = styled(MaterialIcon).attrs({ icon: 'language', size: 18 })`
  vertical-align: middle;
  color: ${amberA400};
`

const Spacer = styled.div`
  flex: 1 1 auto;

  @media screen and (max-width: 720px) {
    width: 16px;
    flex: 0 0;
  }

  @media screen and (max-width: 500px) {
    width: 8px;
    flex: 0 0;
  }
`

const HideWhenSmall = styled.span`
  @media screen and (max-width: 720px) {
    display: none;
  }
`

export function TopLinks({ className }: { className?: string }) {
  const { i18n } = useTranslation()
  const dispatch = useAppDispatch()
  const [languageMenuOpen, openLanguageMenu, closeLanguageMenu] = usePopoverController()
  const [anchor, anchorX, anchorY] = useAnchorPosition('left', 'bottom')

  const onChangeLanguage = useStableCallback(async (language: TranslationLanguage) => {
    try {
      await i18n.changeLanguage(language)
    } catch (error) {
      dispatch(openSnackbar({ message: 'Something went wrong changing the language' }))
      logger.error(`There was an error changing the language: ${error}`)
    }
    closeLanguageMenu()
  })

  return (
    <TopLinksList className={className}>
      {LANGUAGE_SUPPORT ? (
        <Popover
          open={languageMenuOpen}
          onDismiss={closeLanguageMenu}
          anchorX={anchorX ?? 0}
          anchorY={anchorY ?? 0}
          originX={'left'}
          originY={'top'}>
          <MenuList dense={true}>
            {ALL_TRANSLATION_LANGUAGES.map(language => (
              <MenuItem
                key={language}
                text={translationLanguageToLabel(language)}
                onClick={() => onChangeLanguage(language)}
              />
            ))}
          </MenuList>
        </Popover>
      ) : null}

      {!IS_ELECTRON ? (
        <>
          <li>
            <Link href='/splash'>Home</Link>
          </li>
          <li>
            <Link href='/faq'>FAQ</Link>
          </li>
          <li>
            <Link href='/ladder'>Ladder</Link>
          </li>
          <li>
            <Link href='/leagues'>Leagues</Link>
          </li>
          <Spacer />
          <li>
            <IconLink href='https://twitter.com/shieldbatterybw' target='_blank' rel='noopener'>
              <StyledTwitterLogo />
              <HideWhenSmall>Twitter</HideWhenSmall>
            </IconLink>
          </li>
          <li>
            <IconLink href='https://github.com/ShieldBattery' target='_blank' rel='noopener'>
              <StyledGithubLogo />
              <HideWhenSmall>GitHub</HideWhenSmall>
            </IconLink>
          </li>
          <li>
            <HideWhenSmall>
              <a href='https://patreon.com/tec27' target='_blank' rel='noopener'>
                Patreon
              </a>
            </HideWhenSmall>
          </li>
        </>
      ) : null}
      <Spacer />
      {LANGUAGE_SUPPORT ? (
        <li>
          <Tooltip text='Change language'>
            <IconButton ref={anchor} icon={<LanguageIcon />} onClick={openLanguageMenu} />
          </Tooltip>
        </li>
      ) : null}
      <li>
        <Link href='/login'>Log&nbsp;in</Link>
      </li>
    </TopLinksList>
  )
}

export default TopLinks
