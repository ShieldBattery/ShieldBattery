import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'

import AppSettings from './app-settings.jsx'
import Dialog from '../material/dialog.jsx'
import FlatButton from '../material/flat-button.jsx'
import GameSettings from './game-settings.jsx'
import IconButton from '../material/icon-button.jsx'
import { Label } from '../material/button.jsx'
import Tabs, { TabItem } from '../material/tabs.jsx'

import SetPathIcon from '../icons/material/ic_settings_black_36px.svg'

import { openDialog, closeDialog } from '../dialogs/action-creators'
import { mergeLocalSettings } from './action-creators'
import { isStarcraftRemastered } from '../starcraft/is-starcraft-healthy'

import { colorTextSecondary, colorError } from '../styles/colors'
import { Body1, Subheading } from '../styles/typography'

const screen = IS_ELECTRON ? require('electron').remote.screen : null
const getResolution = () => screen.getPrimaryDisplay().size

const TitleActionContainer = styled.div`
  display: flex;
  align-items: center;
  margin-right: 24px;
`

const TitleActionText = styled(Body1)`
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

  & ${Label} {
    color: ${colorTextSecondary};
  }
`

const ContentsBody = styled.div`
  margin-top: 24px;
`

const ErrorText = styled(Subheading)`
  color: ${colorError};
`

const TAB_APP = 0
const TAB_GAME = 1

@connect(state => ({ settings: state.settings, starcraft: state.starcraft }))
export default class Settings extends React.Component {
  state = {
    activeTab: TAB_APP,
  }

  _form = React.createRef()
  _saveButton = React.createRef()
  // NOTE(tec27): Slight optimizaton, since getting the resolution is IPC'd. We assume it will
  // never change while this form is up. I think this is mostly true (and at worst, you just close
  // Settings and re-open it and you're fine)
  _resolution = getResolution()

  componentDidMount() {
    this._saveButton.current.focus()
  }

  renderSettings() {
    const { local } = this.props.settings
    const { activeTab } = this.state

    const isRemastered = isStarcraftRemastered(this.props)

    switch (activeTab) {
      case TAB_APP:
        return (
          <AppSettings
            localSettings={local}
            formRef={this._form}
            onSubmit={this.onSettingsSubmit}
          />
        )
      case TAB_GAME:
        return (
          <GameSettings
            localSettings={local}
            resolution={this._resolution}
            formRef={this._form}
            isRemastered={isRemastered}
            onSubmit={this.onSettingsSubmit}
          />
        )
      default:
        throw new Error('Invalid tab value')
    }
  }

  render() {
    const { onCancel } = this.props
    const { activeTab } = this.state
    const { local } = this.props.settings

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
    const tabs = (
      <Tabs activeTab={activeTab} onChange={this.onTabChange}>
        <TabItem text='App' />
        <TabItem text='Game' />
      </Tabs>
    )
    const buttons = [
      <FlatButton label='Cancel' key='cancel' color='accent' onClick={this.onSettingsCancel} />,
      <FlatButton
        ref={this._saveButton}
        label='Save'
        key='save'
        color='accent'
        onClick={this.onSettingsSave}
      />,
    ]

    return (
      <Dialog
        title={'Settings'}
        titleAction={titleAction}
        tabs={tabs}
        buttons={buttons}
        onCancel={onCancel}>
        <ContentsBody>
          {local.lastError ? (
            <ErrorText>There was an issue saving the settings. Please try again.</ErrorText>
          ) : null}
          {this.renderSettings()}
        </ContentsBody>
      </Dialog>
    )
  }

  onTabChange = value => {
    // TODO(2Pac): Currently, switching a tab effectively discards all the changed settings on the
    // previous tab. Should we remember those, so they're also saved if the settings are submitted?
    this.setState({ activeTab: value })
  }

  onSetPathClick = () => {
    this.props.dispatch(openDialog('starcraftPath'))
  }

  onSettingsSave = () => {
    this._form.current.submit()
  }

  onSettingsCancel = () => {
    this.props.dispatch(closeDialog())
  }

  onSettingsSubmit = newSettings => {
    this.props.dispatch(mergeLocalSettings(newSettings))

    if (!this.props.settings.local.lastError) {
      this.props.dispatch(closeDialog())
    }
  }
}
