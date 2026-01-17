import { TFunction } from 'i18next'
import { useAtom } from 'jotai'
import { AnimatePresence } from 'motion/react'
import { useState } from 'react'
import ReactDOM from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useHistoryState } from 'wouter/use-browser-location'
import { useIsLoggedIn } from '../auth/auth-utils'
import { FocusTrap } from '../dom/focus-trap'
import { useExternalElement } from '../dom/use-external-element-ref'
import { KeyListenerBoundary, useKeyListener } from '../keyboard/key-listener'
import { useButtonState } from '../material/button'
import { Ripple } from '../material/ripple'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { useAppDispatch } from '../redux-hooks'
import { starcraftHealthy } from '../starcraft/health-state'
import { closeSettings, SETTINGS_OPEN_STATE, SETTINGS_PAGE_KEY } from './action-creators'
import { AppSoundSettings } from './app/sound-settings'
import { AppSystemSettings } from './app/system-settings'
import { GameplaySettings } from './game/gameplay-settings'
import { GameInputSettings } from './game/input-settings'
import { GameSoundSettings } from './game/sound-settings'
import { StarcraftSettings } from './game/starcraft-settings'
import { GameVideoSettings } from './game/video-settings'
import {
  Container,
  ErrorIcon,
  ErrorText,
  NavContainer,
  NavEntryRoot,
  NavEntryText,
  NavSectionSeparator,
  NavSectionTitle,
  SettingsContent,
  transition,
  variants,
} from './settings-content'
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

      <SettingsContent title={getSettingsPageTitle({ page, t })} onCloseSettings={onCloseSettings}>
        <SettingsPageDisplay page={page} />
      </SettingsContent>
    </Container>
  )
}

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
  const { t } = useTranslation()
  const [buttonProps, rippleRef] = useButtonState({ disabled, onClick: () => onChangePage(page) })

  const title = getSettingsPageTitle({ page, t })
  return (
    <NavEntryRoot $isActive={isActive} {...buttonProps} tabIndex={0} data-test={testName}>
      {hasError ? (
        <>
          <ErrorIcon />
          <ErrorText>{title}</ErrorText>
        </>
      ) : (
        <NavEntryText>{title}</NavEntryText>
      )}

      <Ripple ref={rippleRef} disabled={disabled} />
    </NavEntryRoot>
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

function getSettingsPageTitle({ page, t }: { page: SettingsPage; t: TFunction }) {
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

  return title
}
