import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { LocalSettingsData, ScrSettingsData } from '../../common/local-settings'
import { closeDialog, openDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { MaterialIcon } from '../icons/material/material-icon'
import { JsonLocalStorageValue } from '../local-storage'
import { IconButton, TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TabItem, Tabs } from '../material/tabs'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { colorError, colorTextSecondary } from '../styles/colors'
import { body1, subtitle1 } from '../styles/typography'
import { mergeLocalSettings, mergeScrSettings } from './action-creators'
import AppSettings from './app-settings'
import GameplaySettings from './gameplay-settings'
import InputSettings from './input-settings'
import { SettingsFormHandle } from './settings-form-ref'
import { LocalSettings, ScrSettings } from './settings-records'
import SoundSettings from './sound-settings'
import VideoSettings from './video-settings'

const TitleActionContainer = styled.div`
  display: flex;
  align-items: center;
  margin-right: 24px;
`

const TitleActionText = styled.div`
  ${body1};
  color: ${colorTextSecondary};
  margin-right: 4px;

  &:hover {
    cursor: pointer;
  }
`

const TitleActionButton = styled(IconButton)`
  flex-shrink: 0;
  min-height: 40px;
  width: 40px;
  line-height: 40px;
`

const ContentsBody = styled.div`
  margin-top: 24px;
`

const ErrorText = styled.div`
  ${subtitle1};
  color: ${colorError};
`

enum SettingsTab {
  App = 'app',
  Input = 'input',
  Video = 'video',
  Sound = 'sound',
  Gameplay = 'gameplay',
}

const savedSettingsTab = new JsonLocalStorageValue<SettingsTab>('settingsTab')

export default function SettingsDialog({ dialogRef, onCancel }: CommonDialogProps) {
  const dispatch = useAppDispatch()
  const localSettings = useAppSelector(s => s.settings.local)
  const scrSettings = useAppSelector(s => s.settings.scr)
  const lastError = useAppSelector(s => s.settings.lastError)

  const [activeTab, setActiveTab] = useState(savedSettingsTab.getValue() ?? SettingsTab.App)
  const [tempLocalSettings, setTempLocalSettings] = useState<LocalSettings>(localSettings)
  const [tempScrSettings, setTempScrSettings] = useState<ScrSettings>(scrSettings)

  const formRef = useRef<SettingsFormHandle>(null)
  const saveButtonRef = useRef<HTMLButtonElement>(null)

  const onTabChange = useCallback((value: SettingsTab) => {
    setActiveTab(value)
    savedSettingsTab.setValue(value)
  }, [])
  const onSetPathClick = useCallback(() => {
    dispatch(openDialog({ type: DialogType.StarcraftPath }))
  }, [dispatch])
  const onSettingsSave = useCallback(() => {
    formRef.current?.submit()
  }, [])
  const onSettingsCancel = useCallback(() => {
    dispatch(closeDialog(DialogType.Settings))
  }, [dispatch])
  const onSettingsChange = useCallback((settings: Partial<LocalSettings & ScrSettings>) => {
    setTempLocalSettings(prev => prev.merge(settings))
    setTempScrSettings(prev => prev.merge(settings))
  }, [])

  const onSettingsSubmit = useCallback(() => {
    // NOTE(tec27): We remove the StarCraft path here because we don't provide a way to change it
    // in this dialog anyway, and depending on how IPC events interleave, the SC Path dialog may
    // not have merged a new path by the time this dialog is first rendered. We don't want to merge
    // an old path back into the settings, so we just remove it instead.
    const localSettingsToMerge = tempLocalSettings.toJS() as Partial<LocalSettingsData>
    delete localSettingsToMerge.starcraftPath
    dispatch(mergeLocalSettings(localSettingsToMerge))
    dispatch(mergeScrSettings(tempScrSettings.toJS() as Partial<ScrSettingsData>))

    // TODO(tec27): This doesn't seem like it would actually catch errors from saving here? Since
    // those would happen async-ly. Should probably have a form of this that doesn't bother with
    // dispatching and just returns a promise we can await
    if (!lastError) {
      dispatch(closeDialog(DialogType.Settings))
    }
  }, [dispatch, tempLocalSettings, tempScrSettings, lastError])

  useEffect(() => {
    saveButtonRef.current?.focus()
  }, [])

  const starcraftVersionText = 'StarCraft: Remastered'
  const titleAction = (
    <TitleActionContainer>
      <TitleActionText onClick={onSetPathClick}>{starcraftVersionText}</TitleActionText>
      <TitleActionButton
        icon={<MaterialIcon icon='settings' />}
        title='Change StarCraft path'
        onClick={onSetPathClick}
      />
    </TitleActionContainer>
  )

  const tabs = (
    <Tabs activeTab={activeTab} onChange={onTabChange}>
      <TabItem key='app' text='App' value={SettingsTab.App} />
      <TabItem key='input' text='Input' value={SettingsTab.Input} />
      <TabItem key='sound' text='Sound' value={SettingsTab.Sound} />
      <TabItem key='video' text='Video' value={SettingsTab.Video} />
      <TabItem key='gameplay' text='Gameplay' value={SettingsTab.Gameplay} />
    </Tabs>
  )

  const buttons = [
    <TextButton label='Cancel' key='cancel' color='accent' onClick={onSettingsCancel} />,
    <TextButton
      ref={saveButtonRef}
      label='Save'
      key='save'
      color='accent'
      onClick={onSettingsSave}
    />,
  ]

  let contents: React.ReactNode
  switch (activeTab) {
    case SettingsTab.App:
      contents = (
        <AppSettings
          localSettings={tempLocalSettings}
          formRef={formRef}
          onChange={onSettingsChange}
          onSubmit={onSettingsSubmit}
        />
      )
      break
    case SettingsTab.Input:
      contents = (
        <InputSettings
          scrSettings={tempScrSettings}
          formRef={formRef}
          onChange={onSettingsChange}
          onSubmit={onSettingsSubmit}
        />
      )
      break
    case SettingsTab.Sound:
      contents = (
        <SoundSettings
          scrSettings={tempScrSettings}
          formRef={formRef}
          onChange={onSettingsChange}
          onSubmit={onSettingsSubmit}
        />
      )
      break
    case SettingsTab.Video:
      contents = (
        <VideoSettings
          scrSettings={tempScrSettings}
          formRef={formRef}
          onChange={onSettingsChange}
          onSubmit={onSettingsSubmit}
        />
      )
      break
    case SettingsTab.Gameplay:
      contents = (
        <GameplaySettings
          localSettings={tempLocalSettings}
          scrSettings={tempScrSettings}
          formRef={formRef}
          onChange={onSettingsChange}
          onSubmit={onSettingsSubmit}
        />
      )
      break
    default:
      contents = assertUnreachable(activeTab)
  }

  return (
    <Dialog
      dialogRef={dialogRef}
      title='Settings'
      titleAction={titleAction}
      tabs={tabs}
      alwaysHasTopDivider={true}
      buttons={buttons}
      onCancel={onCancel}>
      <ContentsBody>
        {lastError ? (
          <ErrorText>There was an issue saving the settings. Please try again.</ErrorText>
        ) : null}

        {contents}
      </ContentsBody>
    </Dialog>
  )
}
