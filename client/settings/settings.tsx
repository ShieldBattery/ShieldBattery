import React, { useCallback, useRef } from 'react'
import ReactDOM from 'react-dom'
import { useTranslation } from 'react-i18next'
import { animated, useTransition, UseTransitionProps } from 'react-spring'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { FocusTrap } from '../dom/focus-trap'
import { useExternalElementRef } from '../dom/use-external-element-ref'
import { MaterialIcon } from '../icons/material/material-icon'
import { KeyListenerBoundary, useKeyListener } from '../keyboard/key-listener'
import { IconButton, useButtonState } from '../material/button'
import { Ripple } from '../material/ripple'
import { defaultSpring } from '../material/springs'
import { Tooltip } from '../material/tooltip'
import { zIndexSettings } from '../material/zindex'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { isStarcraftHealthy as checkIsStarcraftHealthy } from '../starcraft/is-starcraft-healthy'
import { useStableCallback } from '../state-hooks'
import {
  background700,
  background800,
  colorDividers,
  colorError,
  colorTextPrimary,
  colorTextSecondary,
} from '../styles/colors'
import { body2, headline4, overline, singleLine } from '../styles/typography'
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
  settingsSubPageToLabel,
} from './settings-sub-page'

const ESCAPE = 'Escape'

export function ConnectedSettings() {
  const dispatch = useAppDispatch()
  const isOpen = useAppSelector(s => s.settings.open)
  const subPage = useAppSelector(s => s.settings.subPage)
  const starcraft = useAppSelector(s => s.starcraft)

  const focusableRef = useRef<HTMLSpanElement>(null)
  const portalRef = useExternalElementRef()

  const onChangeSubPage = useStableCallback((value: SettingsSubPage) => {
    dispatch(changeSettingsSubPage(value))
  })
  const onCloseSettings = useStableCallback(() => {
    dispatch(closeSettings())
  })

  const settingsTransition = useTransition<boolean, UseTransitionProps<boolean>>(isOpen, {
    from: { opacity: 0 },
    enter: { opacity: 1 },
    leave: { opacity: 0 },
    config: {
      ...defaultSpring,
      clamp: true,
    },
  })

  return ReactDOM.createPortal(
    settingsTransition((style, isOpen) =>
      isOpen ? (
        <KeyListenerBoundary>
          <FocusTrap focusableRef={focusableRef}>
            <span ref={focusableRef} tabIndex={-1}>
              <Settings
                style={style}
                subPage={subPage}
                isStarcraftHealthy={checkIsStarcraftHealthy({ starcraft })}
                onChangeSubPage={onChangeSubPage}
                onCloseSettings={onCloseSettings}
              />
            </span>
          </FocusTrap>
        </KeyListenerBoundary>
      ) : undefined,
    ),
    portalRef.current,
  )
}

const Container = styled(animated.div)`
  position: absolute;
  top: var(--sb-system-bar-height, 0);
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: calc(100% - var(--sb-system-bar-height, 0));

  display: flex;
  flex-direction: row;

  background-color: ${background800};
  z-index: ${zIndexSettings};
`

const NavContainer = styled.div`
  width: 272px;
  padding: 16px 0;
  background-color: ${background700};

  flex-shrink: 0;
`

const NavSectionTitle = styled.div`
  ${overline};
  ${singleLine};

  height: 36px;
  line-height: 36px;
  padding: 0 16px;

  color: ${colorTextSecondary};
`

const NavSectionSeparator = styled.div`
  height: 1px;
  margin: 7px 16px 8px;

  background-color: ${colorDividers};
`

function Settings({
  style,
  subPage,
  isStarcraftHealthy,
  onChangeSubPage,
  onCloseSettings,
}: {
  style: React.CSSProperties
  subPage: SettingsSubPage
  isStarcraftHealthy: boolean
  onChangeSubPage: (subPage: SettingsSubPage) => void
  onCloseSettings: () => void
}) {
  useKeyListener({
    onKeyDown(event) {
      if (event.code === ESCAPE) {
        onCloseSettings()
        return true
      }

      return false
    },
  })

  const getNavEntriesMapper = useCallback(
    ({ disabled, hasError }: { disabled?: boolean; hasError?: boolean } = {}) => {
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
    },
    [onChangeSubPage, subPage],
  )

  return (
    <Container style={style}>
      <NavContainer>
        {IS_ELECTRON ? (
          <>
            <NavSectionTitle>App settings</NavSectionTitle>
            {[AppSettingsSubPage.Sound, AppSettingsSubPage.System].map(getNavEntriesMapper())}

            <NavSectionSeparator />

            <NavSectionTitle>Game settings</NavSectionTitle>
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

const NavEntryRoot = styled.div<{ $isActive: boolean }>`
  position: relative;
  width: 100%;
  height: 36px;
  padding: 0 16px;

  display: flex;
  align-items: center;

  border-radius: 4px;
  cursor: pointer;

  --sb-ripple-color: ${colorTextPrimary};
  background-color: ${props => (props.$isActive ? 'rgba(255, 255, 255, 0.12)' : 'transparent')};

  &[disabled] {
    cursor: auto;
  }

  :focus-visible {
    outline: none;
  }
`

const NavEntryText = styled.span`
  ${body2};
  ${singleLine};

  height: 100%;
  line-height: 36px;
`

const NavEntryIcon = styled(MaterialIcon).attrs({ size: 16 })`
  margin-right: 4px;
`

const ErrorIcon = styled(NavEntryIcon).attrs({ icon: 'error', filled: false })`
  color: ${colorError};
`

const ErrorText = styled(NavEntryText)`
  color: ${colorError};
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
  const { t } = useTranslation()
  const label = settingsSubPageToLabel(subPage, t)

  const onClick = useStableCallback(() => {
    onChangeSubPage(subPage)
  })
  const [buttonProps, rippleRef] = useButtonState({ disabled, onClick })

  return (
    <NavEntryRoot $isActive={isActive} {...buttonProps} tabIndex={0}>
      {hasError ? (
        <>
          <ErrorIcon />
          <ErrorText>{label}</ErrorText>
        </>
      ) : (
        <NavEntryText>{label}</NavEntryText>
      )}

      <Ripple ref={rippleRef} disabled={disabled} />
    </NavEntryRoot>
  )
}

const ContentContainer = styled.div`
  width: 100%;
  max-width: 960px;
  padding: 16px;
  overflow-y: auto;
`

const TitleBar = styled.div`
  position: relative;
  margin-bottom: 8px;

  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
`

const Title = styled.span`
  ${headline4};
`

const CloseIcon = styled(MaterialIcon).attrs({ icon: 'close' })`
  flex-shrink: 0;
`

function SettingsContent({
  subPage,
  onCloseSettings,
}: {
  subPage: SettingsSubPage
  onCloseSettings: () => void
}) {
  const { t } = useTranslation()
  const label = settingsSubPageToLabel(subPage, t)

  return (
    <ContentContainer>
      <TitleBar>
        <Title>{label}</Title>
        <Tooltip text='Close settings (ESC)' position='bottom' tabIndex={-1}>
          <IconButton icon={<CloseIcon />} onClick={onCloseSettings} />
        </Tooltip>
      </TitleBar>

      <SettingsSubPageDisplay subPage={subPage} onCloseSettings={onCloseSettings} />
    </ContentContainer>
  )
}

function SettingsSubPageDisplay({
  subPage,
  onCloseSettings,
}: {
  subPage: SettingsSubPage
  onCloseSettings: () => void
}) {
  // TODO(2Pac): Currently we don't have any non-Electron settings so this might look a bit weird.
  // Once we add some global settings (e.g. editing user account, and changing a language), write a
  // second switch statemt above `IS_ELECTRON` check which handles those pages.

  if (!IS_ELECTRON) {
    throw new Error(`Unknown settings page: ${subPage}`)
  }

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
  }

  return assertUnreachable(subPage)
}
