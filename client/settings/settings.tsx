import { AnimatePresence, Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import React, { useRef } from 'react'
import ReactDOM from 'react-dom'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { useIsLoggedIn } from '../auth/auth-utils'
import { FocusTrap } from '../dom/focus-trap'
import { useExternalElementRef } from '../dom/use-external-element-ref'
import { MaterialIcon } from '../icons/material/material-icon'
import { KeyListenerBoundary, useKeyListener } from '../keyboard/key-listener'
import { IconButton, useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Ripple } from '../material/ripple'
import { Tooltip } from '../material/tooltip'
import { zIndexSettings } from '../material/zindex'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { isStarcraftHealthy as checkIsStarcraftHealthy } from '../starcraft/is-starcraft-healthy'
import { useStableCallback } from '../state-hooks'
import {
  headlineMedium,
  labelMedium,
  labelSmall,
  singleLine,
  titleSmall,
} from '../styles/typography'
import { changeSettingsSubPage, closeSettings } from './action-creators'
import { AppSoundSettings } from './app/sound-settings'
import { AppSystemSettings } from './app/system-settings'
import { GameplaySettings } from './game/gameplay-settings'
import { GameInputSettings } from './game/input-settings'
import { GameSoundSettings } from './game/sound-settings'
import { StarcraftSettings } from './game/starcraft-settings'
import { GameVideoSettings } from './game/video-settings'
import {
  AppSettingsSubPage,
  GameSettingsSubPage,
  SettingsSubPage,
  UserSettingsSubPage,
} from './settings-sub-page'
import { AccountSettings } from './user/account-settings'
import { UserLanguageSettings } from './user/language-settings'

const ESCAPE = 'Escape'

export function ConnectedSettings() {
  const dispatch = useAppDispatch()
  const isLoggedIn = useIsLoggedIn()
  const isOpen = useAppSelector(s => s.settings.open)
  const subPage =
    useAppSelector(s => s.settings.subPage) ??
    (isLoggedIn ? UserSettingsSubPage.Account : UserSettingsSubPage.Language)
  const starcraft = useAppSelector(s => s.starcraft)

  const focusableRef = useRef<HTMLSpanElement>(null)
  const portalRef = useExternalElementRef()

  const onChangeSubPage = useStableCallback((value: SettingsSubPage) => {
    dispatch(changeSettingsSubPage(value))
  })
  const onCloseSettings = useStableCallback(() => {
    dispatch(closeSettings())
  })

  return ReactDOM.createPortal(
    <AnimatePresence>
      {isOpen && (
        <KeyListenerBoundary>
          <FocusTrap focusableRef={focusableRef}>
            <span ref={focusableRef} tabIndex={-1}>
              <Settings
                subPage={subPage}
                isStarcraftHealthy={checkIsStarcraftHealthy({ starcraft })}
                onChangeSubPage={onChangeSubPage}
                onCloseSettings={onCloseSettings}
              />
            </span>
          </FocusTrap>
        </KeyListenerBoundary>
      )}
    </AnimatePresence>,
    portalRef.current,
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
  duration: 0.5,
  bounce: 0,
}

function Settings({
  subPage,
  isStarcraftHealthy,
  onChangeSubPage,
  onCloseSettings,
}: {
  subPage: SettingsSubPage
  isStarcraftHealthy: boolean
  onChangeSubPage: (subPage: SettingsSubPage) => void
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
    return (s: SettingsSubPage) => (
      <NavEntry
        key={s}
        subPage={s}
        isActive={subPage === s}
        disabled={disabled}
        hasError={hasError}
        onChangeSubPage={onChangeSubPage}
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
        {(isLoggedIn ? [UserSettingsSubPage.Account] : []).map(getNavEntriesMapper())}
        {[UserSettingsSubPage.Language].map(getNavEntriesMapper())}

        {IS_ELECTRON ? (
          <>
            <NavSectionSeparator />

            <NavSectionTitle>{t('settings.app.title', 'App')}</NavSectionTitle>
            {[AppSettingsSubPage.Sound, AppSettingsSubPage.System].map(getNavEntriesMapper())}

            <NavSectionSeparator />

            <NavSectionTitle>{t('settings.game.title', 'Game')}</NavSectionTitle>
            {[GameSettingsSubPage.StarCraft].map(
              getNavEntriesMapper({ hasError: !isStarcraftHealthy }),
            )}

            {[
              GameSettingsSubPage.Input,
              GameSettingsSubPage.Sound,
              GameSettingsSubPage.Video,
              GameSettingsSubPage.Gameplay,
            ].map(getNavEntriesMapper({ disabled: !isStarcraftHealthy }))}
          </>
        ) : null}
      </NavContainer>

      <SettingsContent subPage={subPage} onCloseSettings={onCloseSettings} />
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
    cursor: auto;
  }

  :focus-visible {
    outline: none;
  }
`

const NavEntryText = styled(SettingsSubPageTitle)`
  ${titleSmall};
  ${singleLine};

  height: 100%;
  line-height: 36px;
`

const NavEntryIcon = styled(MaterialIcon).attrs({ size: 20 })`
  margin-right: 4px;
`

const ErrorIcon = styled(NavEntryIcon).attrs({ icon: 'error', filled: false })`
  color: var(--theme-error);
  margin-bottom: 2px;
`

const ErrorText = styled(NavEntryText)`
  color: var(--theme-error);
`

function NavEntry({
  subPage,
  isActive,
  disabled,
  hasError,
  onChangeSubPage,
}: {
  subPage: SettingsSubPage
  isActive: boolean
  disabled?: boolean
  hasError?: boolean
  onChangeSubPage: (subPage: SettingsSubPage) => void
}) {
  const onClick = useStableCallback(() => {
    onChangeSubPage(subPage)
  })
  const [buttonProps, rippleRef] = useButtonState({ disabled, onClick })

  return (
    <NavEntryRoot $isActive={isActive} {...buttonProps} tabIndex={0}>
      {hasError ? (
        <>
          <ErrorIcon />
          <ErrorText subPage={subPage} />
        </>
      ) : (
        <NavEntryText subPage={subPage} />
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

const Title = styled(SettingsSubPageTitle)`
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
  subPage,
  onCloseSettings,
}: {
  subPage: SettingsSubPage
  onCloseSettings: () => void
}) {
  const { t } = useTranslation()
  const closeLabel = t('settings.close', 'Close settings')

  return (
    <ContentContainer>
      <Content>
        <TitleBar>
          <Title subPage={subPage} />
        </TitleBar>

        <React.Suspense fallback={<LoadingDotsArea />}>
          <SettingsSubPageDisplay subPage={subPage} />
        </React.Suspense>
      </Content>

      <LabeledCloseButton>
        <Tooltip text={closeLabel} position='left' tabIndex={-1}>
          <CloseButton
            ariaLabel={closeLabel}
            icon={<MaterialIcon icon='close' />}
            onClick={onCloseSettings}
          />
        </Tooltip>
        <span>ESC</span>
      </LabeledCloseButton>
    </ContentContainer>
  )
}

function SettingsSubPageDisplay({ subPage }: { subPage: SettingsSubPage }) {
  switch (subPage) {
    case UserSettingsSubPage.Account:
      return <AccountSettings />
    case UserSettingsSubPage.Language:
      return <UserLanguageSettings />
  }

  if (IS_ELECTRON) {
    switch (subPage) {
      case AppSettingsSubPage.Sound:
        return <AppSoundSettings />
      case AppSettingsSubPage.System:
        return <AppSystemSettings />
      case GameSettingsSubPage.StarCraft:
        return <StarcraftSettings />
      case GameSettingsSubPage.Input:
        return <GameInputSettings />
      case GameSettingsSubPage.Sound:
        return <GameSoundSettings />
      case GameSettingsSubPage.Video:
        return <GameVideoSettings />
      case GameSettingsSubPage.Gameplay:
        return <GameplaySettings />
      default:
        return assertUnreachable(subPage)
    }
  }

  throw new Error('Should have been unreachable for: ' + subPage)
}

function SettingsSubPageTitle({
  subPage,
  className,
}: {
  subPage: SettingsSubPage
  className?: string
}) {
  const { t } = useTranslation()

  let title
  switch (subPage) {
    case UserSettingsSubPage.Account:
      title = t('settings.user.account.label', 'Account')
      break
    case UserSettingsSubPage.Language:
      title = t('settings.user.language.title', 'Language')
      break
    case AppSettingsSubPage.Sound:
      title = t('settings.app.sound.title', 'Sound')
      break
    case AppSettingsSubPage.System:
      title = t('settings.app.system.title', 'System')
      break
    case GameSettingsSubPage.StarCraft:
      title = t('settings.game.starcraft.title', 'StarCraft')
      break
    case GameSettingsSubPage.Input:
      title = t('settings.game.input.title', 'Input')
      break
    case GameSettingsSubPage.Sound:
      title = t('settings.game.sound.title', 'Sound')
      break
    case GameSettingsSubPage.Video:
      title = t('settings.game.video.title', 'Video')
      break
    case GameSettingsSubPage.Gameplay:
      title = t('settings.game.gameplay.title', 'Gameplay')
      break
    default:
      assertUnreachable(subPage)
  }

  return <span className={className}>{title}</span>
}
