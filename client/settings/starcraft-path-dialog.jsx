import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { TypedIpcRenderer } from '../../common/ipc'
import { closeDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import form from '../forms/form'
import SubmitOnEnter from '../forms/submit-on-enter'
import { RaisedButton, TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import { background500, colorError } from '../styles/colors'
import { body1, body2, Subtitle1 } from '../styles/typography'

const ipcRenderer = new TypedIpcRenderer()

const starcraftPathValidator = () => {
  return async starcraftPath => {
    const checkResult = await ipcRenderer.invoke('settingsCheckStarcraftPath', starcraftPath)

    if (!checkResult.path) {
      return 'Select a valid StarCraft path'
    }
    if (!checkResult.version) {
      return 'Select a valid StarCraft version'
    }

    return null
  }
}

function normalizePath(path) {
  return path?.replace(/\\(x86|x86_64)\\?$/, '')
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

const ErrorText = styled(Subtitle1)`
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
    const currentPath = getInputValue('path') || ''

    const selection = await ipcRenderer.invoke('settingsBrowseForStarcraft', currentPath)
    const selectedPath = selection.filePaths[0]
    this._browseButtonRef.current.blur()

    if (selection.canceled || currentPath.toLowerCase() === selectedPath.toLowerCase()) return

    setInputValue('path', normalizePath(selectedPath))
  }
}

const Instructions = styled.div`
  ${body1};
  margin-bottom: 16px;
`

const ExampleText = styled.span`
  ${body2};
  padding: 0 4px;
  background-color: ${background500};
`

@connect(state => ({ settings: state.settings, starcraft: state.starcraft }))
export default class StarcraftPath extends React.Component {
  _form = React.createRef()
  _saveButton = React.createRef()

  componentDidMount() {
    this._saveButton.current.focus()
  }

  render() {
    const { settings, onCancel, dialogRef } = this.props

    const formModel = {
      path: settings.local.starcraftPath,
    }

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
      <Dialog title={'StarCraft Path'} buttons={buttons} onCancel={onCancel} dialogRef={dialogRef}>
        <Instructions>
          Please select the directory where you have installed StarCraft: Remastered.
        </Instructions>
        <Instructions>
          This is usually <ExampleText>C:\Program Files (x86)\StarCraft</ExampleText> but may be
          elsewhere if you have customized it in the Battle.net launcher.
        </Instructions>

        <StarcraftPathForm ref={this._form} model={formModel} onSubmit={this.onSubmit} />
        {settings.lastError ? (
          <ErrorText>There was an issue saving the StarCraft path. Please try again.</ErrorText>
        ) : null}
      </Dialog>
    )
  }

  onSettingsSave = () => {
    this._form.current.submit()
  }

  onSettingsCancel = () => {
    this.props.dispatch(closeDialog(DialogType.StarcraftPath))
  }

  onSubmit = () => {
    const values = this._form.current.getModel()
    const newSettings = {
      starcraftPath: values.path,
    }
    // FIXME(2pac): Save these settings
    // this.props.dispatch(mergeLocalSettings(newSettings))

    if (!this.props.settings.lastError) {
      this.props.dispatch(closeDialog(DialogType.StarcraftPath))
    }
  }
}
