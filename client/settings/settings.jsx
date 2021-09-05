import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { TypedIpcRenderer } from '../../common/ipc'
import { closeDialog, openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import SetPathIcon from '../icons/material/ic_settings_black_36px.svg'
import { IconButton, TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TabItem, Tabs } from '../material/tabs'
import { isStarcraftRemastered } from '../starcraft/is-starcraft-healthy'
import { colorError, colorTextSecondary } from '../styles/colors'
import { Body1Old, SubheadingOld } from '../styles/typography'
import { mergeLocalSettings, mergeScrSettings } from './action-creators'
import AppSettings from './app-settings'
import GameplaySettings from './gameplay-settings'
import InputSettings from './input-settings'
import { LocalSettings, ScrSettings } from './settings-records'
import SoundSettings from './sound-settings'
import VideoSettings from './video-settings'

const ipcRenderer = new TypedIpcRenderer()

const TitleActionContainer = styled.div`
  display: flex;
  align-items: center;
  margin-right: 24px;
`

const TitleActionText = styled(Body1Old)`
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

const ErrorText = styled(SubheadingOld)`
  color: ${colorError};
`

const TAB_APP = 'app'
const TAB_INPUT = 'input'
const TAB_VIDEO = 'video'
const TAB_SOUND = 'sound'
const TAB_GAMEPLAY = 'gameplay'

@connect(state => ({ settings: state.settings, starcraft: state.starcraft }))
export default class Settings extends React.Component {
  state = {
    activeTab: TAB_APP,
    tempLocalSettings: new LocalSettings(this.props.settings.local),
    tempScrSettings: new ScrSettings(this.props.settings.scr),
    resolution: { width: 640, height: 480 },
  }

  _form = React.createRef()
  _saveButton = React.createRef()

  static getDerivedStateFromProps(props, state) {
    // This is needed due to us opening the Settings dialog at the same time as saving the new
    // StarCraft path (in the StarCraft Path dialog), which means the `tempLocalSettings` will get
    // initialized with the old value. We update it manually here to the new value when the path
    // changes.
    if (props.settings.local.starcraftPath !== state.tempLocalSettings.starcraftPath) {
      return {
        tempLocalSettings: state.tempLocalSettings.merge(props.settings.local),
      }
    }
    return null
  }

  componentDidMount() {
    ipcRenderer.invoke('settingsGetPrimaryResolution').then(size => {
      this.setState({ resolution: size })
    })
    this._saveButton.current.focus()
  }

  renderSettings() {
    const { activeTab, tempLocalSettings: local, tempScrSettings: scr } = this.state
    const isRemastered = isStarcraftRemastered(this.props)

    switch (activeTab) {
      case TAB_APP:
        return (
          <AppSettings
            localSettings={local}
            formRef={this._form}
            onChange={this.onSettingsChange}
            onSubmit={this.onSettingsSubmit}
          />
        )
      case TAB_INPUT:
        return (
          <InputSettings
            localSettings={local}
            scrSettings={scr}
            formRef={this._form}
            isRemastered={isRemastered}
            onChange={this.onSettingsChange}
            onSubmit={this.onSettingsSubmit}
          />
        )
      case TAB_SOUND:
        return (
          <SoundSettings
            localSettings={local}
            scrSettings={scr}
            formRef={this._form}
            isRemastered={isRemastered}
            onChange={this.onSettingsChange}
            onSubmit={this.onSettingsSubmit}
          />
        )
      case TAB_VIDEO:
        return (
          <VideoSettings
            localSettings={local}
            scrSettings={scr}
            resolution={this.state.resolution}
            formRef={this._form}
            isRemastered={isRemastered}
            onChange={this.onSettingsChange}
            onSubmit={this.onSettingsSubmit}
          />
        )
      case TAB_GAMEPLAY:
        return (
          <GameplaySettings
            localSettings={local}
            scrSettings={scr}
            formRef={this._form}
            isRemastered={isRemastered}
            onChange={this.onSettingsChange}
            onSubmit={this.onSettingsSubmit}
          />
        )
      default:
        throw new Error('Invalid tab value: ' + activeTab)
    }
  }

  render() {
    const { onCancel, dialogRef } = this.props
    const { activeTab } = this.state
    const { scr, lastError } = this.props.settings

    const isRemastered = isStarcraftRemastered(this.props)
    const starcraftVersionText = isRemastered ? 'StarCraft: Remastered' : 'StarCraft v1.16.1'
    const titleAction = (
      <TitleActionContainer>
        <TitleActionText onClick={this.onSetPathClick}>{starcraftVersionText}</TitleActionText>
        <TitleActionButton
          icon={<SetPathIcon />}
          title='Change StarCraft path'
          onClick={this.onSetPathClick}
        />
      </TitleActionContainer>
    )
    const isTabDisabled = isRemastered && !scr
    const tabItems = [
      <TabItem key='app' text='App' value={TAB_APP} />,
      <TabItem key='input' text='Input' disabled={isTabDisabled} value={TAB_INPUT} />,
    ]
    if (isRemastered) {
      tabItems.push(<TabItem key='sound' text='Sound' disabled={isTabDisabled} value={TAB_SOUND} />)
    }
    tabItems.push(<TabItem key='video' text='Video' disabled={isTabDisabled} value={TAB_VIDEO} />)
    if (isRemastered) {
      tabItems.push(
        <TabItem key='gameplay' text='Gameplay' disabled={isTabDisabled} value={TAB_GAMEPLAY} />,
      )
    }
    const tabs = (
      <Tabs activeTab={activeTab} onChange={this.onTabChange} bottomDivider={true}>
        {tabItems}
      </Tabs>
    )
    const buttons = [
      <TextButton label='Cancel' key='cancel' color='accent' onClick={this.onSettingsCancel} />,
      <TextButton
        ref={this._saveButton}
        label='Save'
        key='save'
        color='accent'
        onClick={this.onSettingsSave}
      />,
    ]

    return (
      <Dialog
        dialogRef={dialogRef}
        title={'Settings'}
        titleAction={titleAction}
        tabs={tabs}
        buttons={buttons}
        onCancel={onCancel}>
        <ContentsBody>
          {lastError ? (
            <ErrorText>There was an issue saving the settings. Please try again.</ErrorText>
          ) : null}
          {this.renderSettings()}
        </ContentsBody>
      </Dialog>
    )
  }

  onTabChange = value => {
    this.setState({ activeTab: value })
  }

  onSetPathClick = () => {
    this.props.dispatch(openDialog(DialogType.StarcraftPath))
  }

  onSettingsSave = () => {
    this._form.current.submit()
  }

  onSettingsCancel = () => {
    this.props.dispatch(closeDialog())
  }

  onSettingsChange = settings => {
    this.setState({
      tempLocalSettings: this.state.tempLocalSettings.merge(settings),
      tempScrSettings: this.state.tempScrSettings.merge(settings),
    })
  }

  onSettingsSubmit = () => {
    this.props.dispatch(mergeLocalSettings(this.state.tempLocalSettings.toJS()))
    this.props.dispatch(mergeScrSettings(this.state.tempScrSettings.toJS()))

    if (!this.props.settings.lastError) {
      this.props.dispatch(closeDialog())
    }
  }
}
