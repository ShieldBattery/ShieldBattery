import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'

import Dialog from '../material/dialog.jsx'
import FlatButton from '../material/flat-button.jsx'
import form from '../forms/form.jsx'
import RaisedButton from '../material/raised-button.jsx'
import SubmitOnEnter from '../forms/submit-on-enter.jsx'
import TextField from '../material/text-field.jsx'

import { openDialog, closeDialog } from '../dialogs/action-creators'
import { mergeLocalSettings } from './action-creators'
import { isStarcraftHealthy } from '../starcraft/is-starcraft-healthy'

import { colorError } from '../styles/colors'
import { Subheading } from '../styles/typography'

const checkStarcraftPath = IS_ELECTRON
  ? require('../starcraft/check-starcraft-path').checkStarcraftPath
  : null
const currentWindow = IS_ELECTRON ? require('electron').remote.getCurrentWindow() : null
const dialog = IS_ELECTRON ? require('electron').remote.dialog : null

const starcraftPathValidator = () => {
  return async starcraftPath => {
    const checkResult = await checkStarcraftPath(starcraftPath)

    if (!checkResult.path) {
      return 'Select a valid StarCraft path'
    }
    if (!checkResult.version) {
      return 'Select a valid StarCraft version'
    }

    return null
  }
}

const SelectFolderContainer = styled.div`
  display: flex;
`

const PathContainer = styled.div`
  flex-grow: 1;
`

const StyledTextField = styled(TextField)`
  flex-grow: 1;
  margin-right: 8px;

  input:hover {
    cursor: pointer;
  }
`

const BrowseButtonContainer = styled.div`
  display: flex;
  align-items: center;
  height: 56px;
`

const ErrorText = styled(Subheading)`
  color: ${colorError};
`

@form({
  path: starcraftPathValidator(),
})
class StarcraftPathForm extends React.Component {
  _browseButtonRef = React.createRef()

  render() {
    const { bindInput, onSubmit } = this.props

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <SelectFolderContainer>
          <PathContainer onClick={this.onBrowseClick}>
            <StyledTextField {...bindInput('path')} label='StarCraft folder path' disabled={true} />
          </PathContainer>
          <BrowseButtonContainer>
            <RaisedButton ref={this._browseButtonRef} label='Browse' onClick={this.onBrowseClick} />
          </BrowseButtonContainer>
        </SelectFolderContainer>
      </form>
    )
  }

  onBrowseClick = async () => {
    const { getInputValue, setInputValue } = this.props
    const currentPath = getInputValue('path')

    const selection = await dialog.showOpenDialog(currentWindow, {
      title: 'Select StarCraft folder',
      defaultPath: currentPath,
      properties: ['openDirectory'],
    })
    const selectedPath = selection.filePaths[0]
    this._browseButtonRef.current.blur()

    if (selection.canceled || currentPath.toLowerCase() === selectedPath.toLowerCase()) return

    setInputValue('path', selectedPath)
  }
}

@connect(state => ({ settings: state.settings, starcraft: state.starcraft }))
export default class StarcraftPath extends React.Component {
  _form = React.createRef()
  _saveButton = React.createRef()

  componentDidMount() {
    this._saveButton.current.focus()
  }

  render() {
    const { settings, onCancel } = this.props

    const formModel = {
      path: settings.local.starcraftPath,
    }

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
      <Dialog title={'StarCraft Path'} buttons={buttons} onCancel={onCancel}>
        <StarcraftPathForm ref={this._form} model={formModel} onSubmit={this.onSubmit} />
        {settings.local.lastError ? (
          <ErrorText>There was an issue saving the StarCraft path. Please try again.</ErrorText>
        ) : null}
      </Dialog>
    )
  }

  onSettingsSave = () => {
    this._form.current.submit()
  }

  onSettingsCancel = () => {
    if (isStarcraftHealthy(this.props)) {
      this.props.dispatch(openDialog('settings'))
    } else {
      this.props.dispatch(closeDialog())
    }
  }

  onSubmit = () => {
    const values = this._form.current.getModel()
    const newSettings = {
      starcraftPath: values.path,
    }
    this.props.dispatch(mergeLocalSettings(newSettings))

    if (!this.props.settings.local.lastError) {
      this.props.dispatch(openDialog('settings'))
    }
  }
}
