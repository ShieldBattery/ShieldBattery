import { AnimatePresence } from 'motion/react'
import { useState } from 'react'
import ReactDOM from 'react-dom'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useHistoryState } from 'wouter/use-browser-location'
import {
  BasicChannelInfo,
  DetailedChannelInfo,
  JoinedChannelInfo,
  SbChannelId,
} from '../../../common/chat'
import { FocusTrap } from '../../dom/focus-trap'
import { useExternalElement } from '../../dom/use-external-element-ref'
import { KeyListenerBoundary, useKeyListener } from '../../keyboard/key-listener'
import { useButtonState } from '../../material/button'
import { Ripple } from '../../material/ripple'
import { LoadingDotsArea } from '../../progress/dots'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import {
  Container,
  NavContainer,
  NavEntryRoot,
  NavEntryText,
  NavSectionTitle,
  SettingsContent,
  transition,
  variants,
} from '../../settings/settings-content'
import {
  CHANNEL_SETTINGS_OPEN_STATE,
  closeChannelSettings,
} from './channel-settings-action-creators'
import { ChannelSettingsPage, GeneralChannelSettingsPage } from './channel-settings-page'
import { GeneralSettings } from './general-settings'

const ESCAPE = 'Escape'

export function ConnectedChannelSettings({ channelId }: { channelId: SbChannelId }) {
  const dispatch = useAppDispatch()
  const isOpen = useHistoryState() === CHANNEL_SETTINGS_OPEN_STATE

  const [focusableElem, setFocusableElem] = useState<HTMLSpanElement | null>(null)
  const portalElem = useExternalElement()

  return ReactDOM.createPortal(
    <AnimatePresence>
      {isOpen && (
        <KeyListenerBoundary>
          <FocusTrap focusableElem={focusableElem}>
            <span ref={setFocusableElem} tabIndex={-1}>
              <ChannelSettings
                channelId={channelId}
                onCloseSettings={() => {
                  dispatch(closeChannelSettings())
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

const StyledSettingsContent = styled(SettingsContent)`
  max-width: 840px;
  min-width: 0;
`

function ChannelSettings({
  channelId,
  onCloseSettings,
}: {
  channelId: SbChannelId
  onCloseSettings: () => void
}) {
  const basicChannelInfo = useAppSelector(s => s.chat.idToBasicInfo.get(channelId))
  const detailedChannelInfo = useAppSelector(s => s.chat.idToDetailedInfo.get(channelId))
  const joinedChannelInfo = useAppSelector(s => s.chat.idToJoinedInfo.get(channelId))

  const [activePage, setActivePage] = useState<ChannelSettingsPage>(
    GeneralChannelSettingsPage.General,
  )

  useKeyListener({
    onKeyDown(event) {
      if (event.code === ESCAPE) {
        onCloseSettings()
        return true
      }

      return false
    },
  })

  return (
    <Container
      key='channel-settings'
      variants={variants}
      initial='hidden'
      animate='visible'
      exit='hidden'
      transition={transition}>
      <NavContainer>
        <NavSectionTitle>{`#${basicChannelInfo?.name}`}</NavSectionTitle>
        <NavEntry
          page={GeneralChannelSettingsPage.General}
          isActive={activePage === GeneralChannelSettingsPage.General}
          onChangePage={setActivePage}
          testName='general-nav-entry'
        />
      </NavContainer>

      <StyledSettingsContent title={`#${basicChannelInfo?.name}`} onCloseSettings={onCloseSettings}>
        {basicChannelInfo && detailedChannelInfo && joinedChannelInfo ? (
          <ChannelSettingsPageDisplay
            page={activePage}
            basicChannelInfo={basicChannelInfo}
            detailedChannelInfo={detailedChannelInfo}
            joinedChannelInfo={joinedChannelInfo}
            onCloseSettings={onCloseSettings}
          />
        ) : (
          <LoadingDotsArea />
        )}
      </StyledSettingsContent>
    </Container>
  )
}

function NavEntry({
  page,
  isActive,
  onChangePage,
  testName,
}: {
  page: ChannelSettingsPage
  isActive: boolean
  onChangePage: (page: ChannelSettingsPage) => void
  testName?: string
}) {
  const { t } = useTranslation()
  const [buttonProps, rippleRef] = useButtonState({ onClick: () => onChangePage(page) })

  const getPageLabel = (page: ChannelSettingsPage): string => {
    switch (page) {
      case GeneralChannelSettingsPage.General:
        return t('chat.channelSettings.tabs.general', 'General')
      default:
        return page satisfies never
    }
  }

  return (
    <NavEntryRoot $isActive={isActive} {...buttonProps} tabIndex={0} data-test={testName}>
      <NavEntryText>{getPageLabel(page)}</NavEntryText>
      <Ripple ref={rippleRef} />
    </NavEntryRoot>
  )
}

function ChannelSettingsPageDisplay({
  page,
  basicChannelInfo,
  detailedChannelInfo,
  joinedChannelInfo,
  onCloseSettings,
}: {
  page: ChannelSettingsPage
  basicChannelInfo: BasicChannelInfo
  detailedChannelInfo: DetailedChannelInfo
  joinedChannelInfo: JoinedChannelInfo
  onCloseSettings: () => void
}) {
  switch (page) {
    case GeneralChannelSettingsPage.General:
      return (
        <GeneralSettings
          basicChannelInfo={basicChannelInfo}
          detailedChannelInfo={detailedChannelInfo}
          joinedChannelInfo={joinedChannelInfo}
          onCloseSettings={onCloseSettings}
        />
      )
    default:
      return page satisfies never
  }
}
