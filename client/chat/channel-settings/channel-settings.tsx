import { TFunction } from 'i18next'
import { AnimatePresence } from 'motion/react'
import React, { useState } from 'react'
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
import { useHasAnyPermission } from '../../admin/admin-permissions'
import { useSelfUser } from '../../auth/auth-utils'
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
  NavSectionSeparator,
  NavSectionTitle,
  SettingsContent,
  transition,
  variants,
} from '../../settings/settings-content'
import {
  CHANNEL_SETTINGS_OPEN_STATE,
  closeChannelSettings,
} from './channel-settings-action-creators'
import {
  ChannelSettingsPage,
  GeneralChannelSettingsPage,
  UsersChannelSettingsPage,
} from './channel-settings-page'
import { GeneralSettings } from './general-settings'
import { UserPermissionsSettings } from './user-permissions-settings'

const ESCAPE = 'Escape'

/**
 * Renders channel settings in a portal outside of the React root, animating them in and out as
 * `isOpen` changes and holding focus inside them while they're open.
 */
export function ChannelSettingsOverlay({
  isOpen,
  children,
}: {
  isOpen: boolean
  children: React.ReactNode
}) {
  const [focusableElem, setFocusableElem] = useState<HTMLSpanElement | null>(null)
  const portalElem = useExternalElement()

  return ReactDOM.createPortal(
    <AnimatePresence>
      {isOpen && (
        <KeyListenerBoundary>
          <FocusTrap focusableElem={focusableElem}>
            <span ref={setFocusableElem} tabIndex={-1}>
              {children}
            </span>
          </FocusTrap>
        </KeyListenerBoundary>
      )}
    </AnimatePresence>,
    portalElem,
  )
}

export function ConnectedChannelSettings({ channelId }: { channelId: SbChannelId }) {
  const dispatch = useAppDispatch()
  const isOpen = useHistoryState() === CHANNEL_SETTINGS_OPEN_STATE

  return (
    <ChannelSettingsOverlay isOpen={isOpen}>
      <ChannelSettingsFromStore
        channelId={channelId}
        onCloseSettings={() => {
          dispatch(closeChannelSettings())
        }}
      />
    </ChannelSettingsOverlay>
  )
}

/**
 * Channel settings for a channel the viewer has open in chat, fed by the channel data in the store
 * and acting with whatever authority the viewer holds in that channel.
 */
function ChannelSettingsFromStore({
  channelId,
  onCloseSettings,
}: {
  channelId: SbChannelId
  onCloseSettings: () => void
}) {
  const selfUser = useSelfUser()
  const isServerModerator = useHasAnyPermission('moderateChatChannels')
  const channelPermissions = useAppSelector(s => s.chat.idToSelfPermissions.get(channelId))
  const basicChannelInfo = useAppSelector(s => s.chat.idToBasicInfo.get(channelId))
  const detailedChannelInfo = useAppSelector(s => s.chat.idToDetailedInfo.get(channelId))
  const joinedChannelInfo = useAppSelector(s => s.chat.idToJoinedInfo.get(channelId))

  const isOwner = joinedChannelInfo && selfUser && joinedChannelInfo.ownerId === selfUser.id
  const hasEditPermissions = channelPermissions && !!channelPermissions.editPermissions
  // Official channels have no owner, so server moderators hold the owner's authority in them.
  const hasOfficialChannelAuthority = isServerModerator && !!basicChannelInfo?.official

  return (
    <ChannelSettings
      basicChannelInfo={basicChannelInfo}
      detailedChannelInfo={detailedChannelInfo}
      joinedChannelInfo={joinedChannelInfo}
      canAccessGeneralPage={!!(isOwner || hasOfficialChannelAuthority)}
      canAccessPermissionsPage={!!(isOwner || hasEditPermissions || hasOfficialChannelAuthority)}
      isAdmin={false}
      onCloseSettings={onCloseSettings}
    />
  )
}

const StyledSettingsContent = styled(SettingsContent)`
  max-width: 840px;
  min-width: 0;
`

export function ChannelSettings({
  basicChannelInfo,
  detailedChannelInfo,
  joinedChannelInfo,
  canAccessGeneralPage,
  canAccessPermissionsPage,
  isAdmin,
  onCloseSettings,
}: {
  basicChannelInfo?: BasicChannelInfo
  detailedChannelInfo?: DetailedChannelInfo
  joinedChannelInfo?: JoinedChannelInfo
  canAccessGeneralPage: boolean
  canAccessPermissionsPage: boolean
  /** Whether to make changes through the membership-free admin endpoints, as moderating staff. */
  isAdmin: boolean
  onCloseSettings: () => void
}) {
  const { t } = useTranslation()

  const defaultPage = canAccessGeneralPage
    ? GeneralChannelSettingsPage.General
    : UsersChannelSettingsPage.Permissions

  const [activePage, setActivePage] = useState<ChannelSettingsPage>(defaultPage)

  useKeyListener({
    onKeyDown(event) {
      if (event.code === ESCAPE) {
        onCloseSettings()
        return true
      }

      return false
    },
  })

  const channelName = basicChannelInfo?.name
    ? `#${basicChannelInfo.name}`
    : t('common.loading.channelName', 'Channel name loading…')

  return (
    <Container
      key='channel-settings'
      variants={variants}
      initial='hidden'
      animate='visible'
      exit='hidden'
      transition={transition}>
      <NavContainer>
        {canAccessGeneralPage && (
          <>
            <NavSectionTitle>{channelName}</NavSectionTitle>
            <NavEntry
              page={GeneralChannelSettingsPage.General}
              isActive={activePage === GeneralChannelSettingsPage.General}
              onChangePage={setActivePage}
              testName='general-nav-entry'
            />
          </>
        )}
        {canAccessPermissionsPage && (
          <>
            {canAccessGeneralPage && <NavSectionSeparator />}
            <NavSectionTitle>{t('chat.channelSettings.users.title', 'Users')}</NavSectionTitle>
            <NavEntry
              page={UsersChannelSettingsPage.Permissions}
              isActive={activePage === UsersChannelSettingsPage.Permissions}
              onChangePage={setActivePage}
              testName='permissions-nav-entry'
            />
          </>
        )}
      </NavContainer>

      <StyledSettingsContent
        title={getChannelSettingsPageTitle({
          page: activePage,
          channelName,
          t,
        })}
        onCloseSettings={onCloseSettings}>
        {basicChannelInfo && detailedChannelInfo && joinedChannelInfo ? (
          <ChannelSettingsPageDisplay
            page={activePage}
            basicChannelInfo={basicChannelInfo}
            detailedChannelInfo={detailedChannelInfo}
            joinedChannelInfo={joinedChannelInfo}
            isAdmin={isAdmin}
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
      case UsersChannelSettingsPage.Permissions:
        return t('chat.channelSettings.tabs.permissions', 'Permissions')
      default:
        return page satisfies never
    }
  }

  return (
    <NavEntryRoot $isActive={isActive} {...buttonProps} tabIndex={0} data-testid={testName}>
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
  isAdmin,
  onCloseSettings,
}: {
  page: ChannelSettingsPage
  basicChannelInfo: BasicChannelInfo
  detailedChannelInfo: DetailedChannelInfo
  joinedChannelInfo: JoinedChannelInfo
  isAdmin: boolean
  onCloseSettings: () => void
}) {
  switch (page) {
    case GeneralChannelSettingsPage.General:
      return (
        <GeneralSettings
          basicChannelInfo={basicChannelInfo}
          detailedChannelInfo={detailedChannelInfo}
          joinedChannelInfo={joinedChannelInfo}
          isAdmin={isAdmin}
          onCloseSettings={onCloseSettings}
        />
      )
    case UsersChannelSettingsPage.Permissions:
      return (
        <UserPermissionsSettings
          basicChannelInfo={basicChannelInfo}
          detailedChannelInfo={detailedChannelInfo}
          joinedChannelInfo={joinedChannelInfo}
          isAdmin={isAdmin}
          onCloseSettings={onCloseSettings}
        />
      )
    default:
      return page satisfies never
  }
}

function getChannelSettingsPageTitle({
  page,
  channelName,
  t,
}: {
  page: ChannelSettingsPage
  channelName: string
  t: TFunction
}) {
  switch (page) {
    case GeneralChannelSettingsPage.General:
      return channelName
    case UsersChannelSettingsPage.Permissions:
      return t('chat.channelSettings.users.title', 'Users')
    default:
      return page satisfies never
  }
}
