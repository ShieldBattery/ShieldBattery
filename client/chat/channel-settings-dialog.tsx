import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { assertUnreachable } from '../../common/assert-unreachable'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { ChannelSettingsDialogPayload } from '../dialogs/dialog-type'
import { useButtonState } from '../material/button'
import { Dialog } from '../material/dialog'
import { Ripple } from '../material/ripple'
import { useAppSelector } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import { colorDividers, colorTextPrimary } from '../styles/colors'
import { body1, singleLine } from '../styles/typography'
import { ALL_CHANNEL_SETTINGS_SECTIONS, ChannelSettingsSection } from './channel-settings-section'
import { ChannelSettingsGeneral } from './settings/general'

const Container = styled.div`
  display: flex;
  gap: 20px;
`

const NavContainer = styled.div`
  flex-shrink: 0;
  width: 160px;
`

const Divider = styled.div`
  flex-shrink: 0;
  width: 1px;

  background-color: ${colorDividers};
`

const ContentContainer = styled.div`
  flex-grow: 1;
`

type ChannelSettingsDialogProps = CommonDialogProps &
  ReadonlyDeep<ChannelSettingsDialogPayload['initData']>

export function ChannelSettingsDialog({
  dialogRef,
  onCancel,
  channelId,
}: ChannelSettingsDialogProps) {
  const basicChannelInfo = useAppSelector(s => s.chat.idToBasicInfo.get(channelId))
  const detailedChannelInfo = useAppSelector(s => s.chat.idToDetailedInfo.get(channelId))
  const joinedChannelInfo = useAppSelector(s => s.chat.idToJoinedInfo.get(channelId))
  const [section, setSection] = useState<ChannelSettingsSection>(ChannelSettingsSection.General)

  let settingsContent
  switch (section) {
    case ChannelSettingsSection.General:
      settingsContent = (
        <ChannelSettingsGeneral
          channelId={channelId}
          channelDescription={detailedChannelInfo?.description}
          channelTopic={joinedChannelInfo?.topic}
        />
      )
      break
    default:
      assertUnreachable(section)
  }

  return (
    <Dialog
      dialogRef={dialogRef}
      showCloseButton={true}
      title={`#${basicChannelInfo?.name}`}
      onCancel={onCancel}>
      <Container>
        <NavContainer>
          {ALL_CHANNEL_SETTINGS_SECTIONS.map(s => (
            <NavEntry key={s} section={s} isActive={section === s} onChangeSection={setSection} />
          ))}
        </NavContainer>

        <Divider />

        <ContentContainer>{settingsContent}</ContentContainer>
      </Container>
    </Dialog>
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
  overflow: hidden;
  cursor: pointer;

  --sb-ripple-color: ${colorTextPrimary};
  background-color: ${props => (props.$isActive ? 'rgba(255, 255, 255, 0.12)' : 'transparent')};

  :focus-visible {
    outline: none;
  }
`

const NavEntryText = styled.span`
  ${body1};
  ${singleLine};

  height: 100%;
  line-height: 36px;
`

function NavEntry({
  section,
  isActive,
  onChangeSection,
}: {
  section: ChannelSettingsSection
  isActive: boolean
  onChangeSection: (section: ChannelSettingsSection) => void
}) {
  const { t } = useTranslation()
  const onClick = useStableCallback(() => {
    onChangeSection(section)
  })
  const [buttonProps, rippleRef] = useButtonState({ onClick })

  let title
  switch (section) {
    case ChannelSettingsSection.General:
      title = t('chat.channelSettings.general.title', 'General')
      break
    default:
      assertUnreachable(section)
  }

  return (
    <NavEntryRoot $isActive={isActive} {...buttonProps} tabIndex={0}>
      <NavEntryText>{title}</NavEntryText>

      <Ripple ref={rippleRef} />
    </NavEntryRoot>
  )
}
