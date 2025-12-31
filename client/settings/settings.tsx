import { useAtom } from 'jotai'
import { AnimatePresence, Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import React, { useState } from 'react'
import ReactDOM from 'react-dom'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useHistoryState } from 'wouter/use-browser-location'
import { useIsLoggedIn } from '../auth/auth-utils'
import { FocusTrap } from '../dom/focus-trap'
import { useExternalElement } from '../dom/use-external-element-ref'
import { MaterialIcon } from '../icons/material/material-icon'
import { KeyListenerBoundary, useKeyListener } from '../keyboard/key-listener'
import { IconButton, useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Ripple } from '../material/ripple'
import { Tooltip } from '../material/tooltip'
import { zIndexSettings } from '../material/zindex'
import { LoadingDotsArea } from '../progress/dots'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { useAppDispatch } from '../redux-hooks'
import { starcraftHealthy } from '../starcraft/health-state'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import {
  headlineMedium,
  labelMedium,
  labelSmall,
  singleLine,
  titleSmall,
} from '../styles/typography'
import { closeSettings, SETTINGS_OPEN_STATE, SETTINGS_PAGE_KEY } from './action-creators'
import { AppSoundSettings } from './app/sound-settings'
import { AppSystemSettings } from './app/system-settings'
import { GameplaySettings } from './game/gameplay-settings'
import { GameInputSettings } from './game/input-settings'
import { GameSoundSettings } from './game/sound-settings'
import { StarcraftSettings } from './game/starcraft-settings'
import { GameVideoSettings } from './game/video-settings'
import {
  ALL_SETTINGS_PAGES,
  AppSettingsPage,
  GameSettingsPage,
  SettingsPage,
  UserSettingsPage,
} from './settings-page'
import { AccountSettings } from './user/account-settings'
import { UserLanguageSettings } from './user/language-settings'

const ESCAPE = 'Escape'

export function ConnectedSettings() {
  const dispatch = useAppDispatch()
  const isLoggedIn = useIsLoggedIn()
  const isOpen = useHistoryState() === SETTINGS_OPEN_STATE
  const [page, setPage] = useUserLocalStorageValue<SettingsPage>(
    SETTINGS_PAGE_KEY,
    isLoggedIn ? UserSettingsPage.Account : UserSettingsPage.Language,
    value => {
      if (ALL_SETTINGS_PAGES.includes(value as SettingsPage)) {
        return value as SettingsPage
      } else {
        return undefined
      }
    },
  )
  const [healthy] = useAtom(starcraftHealthy)

  const [focusableElem, setFocusableElem] = useState<HTMLSpanElement | null>(null)
  const portalElem = useExternalElement()

  return ReactDOM.createPortal(
    <AnimatePresence>
      {isOpen && (
        <KeyListenerBoundary>
          <FocusTrap focusableElem={focusableElem}>
            <span ref={setFocusableElem} tabIndex={-1}>
              <Settings
                page={page}
                isStarcraftHealthy={healthy}
                onChangePage={setPage}
                onCloseSettings={() => {
                  dispatch(closeSettings())
                }}
              />
            </span>
          </FocusTrap>
        </KeyListenerBoundary>
      )}
    </AnimatePresence>,
    portalElem,
  )
}

const Container = styled(m.div)`
  position: absolute;
  top: var(--sb-system-bar-height, 0);
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: calc(100% - var(--sb-system-bar-height, 0));

  display: flex;
  flex-direction: row;

  background-color: var(--theme-container-lowest);
  contain: content;
  z-index: ${zIndexSettings};
`

const NavContainer = styled.div`
  width: 272px;
  padding: 16px 0;
  background-color: var(--color-grey-blue30);

  flex-shrink: 0;
`

const NavSectionTitle = styled.div`
  ${labelMedium};
  ${singleLine};

  height: 36px;
  line-height: 36px;
  padding: 0 16px;

  color: var(--theme-on-surface-variant);
`

const NavSectionSeparator = styled.div`
  height: 1px;
  margin: 7px 16px 8px;

  background-color: var(--theme-outline-variant);
`

const variants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
}

const transition: Transition = {
  type: 'spring',
  duration: 0.3,
  bounce: 0,
}

function Settings({
  page,
  isStarcraftHealthy,
  onChangePage,
  onCloseSettings,
}: {
  page: SettingsPage
  isStarcraftHealthy: boolean
  onChangePage: (page: SettingsPage) => void
  onCloseSettings: () => void
}) {
  const { t } = useTranslation()
  const isLoggedIn = useIsLoggedIn()

  useKeyListener({
    onKeyDown(event) {
      if (event.code === ESCAPE) {
        onCloseSettings()
        return true
      }

      return false
    },
  })

  const getNavEntriesMapper = ({
    disabled,
    hasError,
  }: { disabled?: boolean; hasError?: boolean } = {}) => {
    return (s: SettingsPage) => (
      <NavEntry
        key={s}
        page={s}
        isActive={page === s}
        disabled={disabled}
        hasError={hasError}
        testName={`${s}-nav-entry`}
        onChangePage={onChangePage}
      />
    )
  }

  return (
    <Container
      key='settings'
      variants={variants}
      initial='hidden'
      animate='visible'
      exit='hidden'
      transition={transition}>
      <NavContainer>
        <NavSectionTitle>{t('settings.user.title', 'User')}</NavSectionTitle>
        {(isLoggedIn ? [UserSettingsPage.Account] : []).map(getNavEntriesMapper())}
        {[UserSettingsPage.Language].map(getNavEntriesMapper())}

        {IS_ELECTRON ? (
          <>
            <NavSectionSeparator />

            <NavSectionTitle>{t('settings.app.title', 'App')}</NavSectionTitle>
            {[AppSettingsPage.Sound, AppSettingsPage.System].map(getNavEntriesMapper())}

            <NavSectionSeparator />

            <NavSectionTitle>{t('settings.game.title', 'Game')}</NavSectionTitle>
            {[GameSettingsPage.StarCraft].map(
              getNavEntriesMapper({ hasError: !isStarcraftHealthy }),
            )}

            {[
              GameSettingsPage.Input,
              GameSettingsPage.Sound,
              GameSettingsPage.Video,
              GameSettingsPage.Gameplay,
            ].map(getNavEntriesMapper({ disabled: !isStarcraftHealthy }))}
          </>
        ) : null}
      </NavContainer>

      <SettingsContent page={page} onCloseSettings={onCloseSettings} />
    </Container>
  )
}

const NavEntryRoot = styled.button<{ $isActive: boolean }>`
  ${buttonReset};
  position: relative;
  width: 100%;
  height: 36px;
  padding: 0 16px;

  display: flex;
  align-items: center;

  border-radius: 4px;
  contain: content;
  cursor: pointer;

  --sb-ripple-color: var(--theme-on-surface);
  background-color: ${props =>
    props.$isActive ? 'rgb(from var(--theme-on-surface) r g b / 0.08)' : 'transparent'};
  color: ${props => (props.$isActive ? 'var(--theme-amber)' : 'var(--theme-on-surface)')};

  transition: color 125ms linear;

  &[disabled] {
    cursor: not-allowed;
    color: rgba(from var(--theme-on-surface) r g b / var(--theme-disabled-opacity));
  }

  :focus-visible {
    outline: none;
  }
`

const NavEntryText = styled(SettingsPageTitle)`
  ${titleSmall};
  ${singleLine};

  height: 100%;
  line-height: 36px;
`

const NavEntryIcon = styled(MaterialIcon).attrs({ size: 20 })`
  margin-right: 4px;
`

const ErrorIcon = styledWithAttrs(NavEntryIcon, { icon: 'error', filled: false })`
  color: var(--theme-error);
  margin-bottom: 2px;
`

const ErrorText = styled(NavEntryText)`
  color: var(--theme-error);
`

function NavEntry({
  page,
  isActive,
  disabled,
  hasError,
  testName,
  onChangePage,
}: {
  page: SettingsPage
  isActive: boolean
  disabled?: boolean
  hasError?: boolean
  testName?: string
  onChangePage: (page: SettingsPage) => void
}) {
  const [buttonProps, rippleRef] = useButtonState({ disabled, onClick: () => onChangePage(page) })

  return (
    <NavEntryRoot $isActive={isActive} {...buttonProps} tabIndex={0} data-test={testName}>
      {hasError ? (
        <>
          <ErrorIcon />
          <ErrorText page={page} />
        </>
      ) : (
        <NavEntryText page={page} />
      )}

      <Ripple ref={rippleRef} disabled={disabled} />
    </NavEntryRoot>
  )
}

const ContentContainer = styled.div`
  width: 100%;
  padding: 16px;
  overflow-y: auto;

  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 40px;
`

const Content = styled.div`
  flex-grow: 1;
  max-width: 704px;
`

const TitleBar = styled.div`
  position: relative;
  margin-bottom: 16px;

  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
`

const Title = styled(SettingsPageTitle)`
  ${headlineMedium};
`

const CloseButton = styled(IconButton)`
  &::after {
    content: '';
    position: absolute;
    width: 100%;
    height: 100%;
    border: 2px solid var(--theme-outline);
    border-radius: inherit;
  }
`

const LabeledCloseButton = styled.div`
  ${labelSmall};
  display: flex;
  flex-direction: column;
  gap: 4px;

  color: var(--theme-on-surface-variant);
  text-align: center;
`

function SettingsContent({
  page,
  onCloseSettings,
}: {
  page: SettingsPage
  onCloseSettings: () => void
}) {
  const { t } = useTranslation()
  const closeLabel = t('settings.close', 'Close settings')

  return (
    <ContentContainer>
      <Content>
        <TitleBar>
          <Title page={page} />
        </TitleBar>

        <React.Suspense fallback={<LoadingDotsArea />}>
          <SettingsPageDisplay page={page} />
        </React.Suspense>
      </Content>

      <LabeledCloseButton>
        <Tooltip text={closeLabel} position='left' tabIndex={-1}>
          <CloseButton
            ariaLabel={closeLabel}
            icon={<MaterialIcon icon='close' />}
            onClick={onCloseSettings}
            testName='close-settings'
          />
        </Tooltip>
        <span>ESC</span>
      </LabeledCloseButton>
    </ContentContainer>
  )
}

function SettingsPageDisplay({ page }: { page: SettingsPage }) {
  switch (page) {
    case UserSettingsPage.Account:
      return <AccountSettings />
    case UserSettingsPage.Language:
      return <UserLanguageSettings />
  }

  if (IS_ELECTRON) {
    switch (page) {
      case AppSettingsPage.Sound:
        return <AppSoundSettings />
      case AppSettingsPage.System:
        return <AppSystemSettings />
      case GameSettingsPage.StarCraft:
        return <StarcraftSettings />
      case GameSettingsPage.Input:
        return <GameInputSettings />
      case GameSettingsPage.Sound:
        return <GameSoundSettings />
      case GameSettingsPage.Video:
        return <GameVideoSettings />
      case GameSettingsPage.Gameplay:
        return <GameplaySettings />
      default:
        page satisfies never
    }
  }

  throw new Error('Should have been unreachable for: ' + page)
}

function SettingsPageTitle({ page, className }: { page: SettingsPage; className?: string }) {
  const { t } = useTranslation()

  let title: string
  switch (page) {
    case UserSettingsPage.Account:
      title = t('settings.user.account.label', 'Account')
      break
    case UserSettingsPage.Language:
      title = t('settings.user.language.title', 'Language')
      break
    case AppSettingsPage.Sound:
      title = t('settings.app.sound.title', 'Sound')
      break
    case AppSettingsPage.System:
      title = t('settings.app.system.title', 'System')
      break
    case GameSettingsPage.StarCraft:
      title = t('settings.game.starcraft.title', 'StarCraft')
      break
    case GameSettingsPage.Input:
      title = t('settings.game.input.title', 'Input')
      break
    case GameSettingsPage.Sound:
      title = t('settings.game.sound.title', 'Sound')
      break
    case GameSettingsPage.Video:
      title = t('settings.game.video.title', 'Video')
      break
    case GameSettingsPage.Gameplay:
      title = t('settings.game.gameplay.title', 'Gameplay')
      break
    default:
      title = page satisfies never
  }

  return <span className={className}>{title}</span>
}
