import { List, Map } from 'immutable'
import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import FileInput from '../forms/file-input'
import form from '../forms/form'
import SuccessIcon from '../icons/material/baseline-check_circle-24px.svg'
import ErrorIcon from '../icons/material/baseline-error-24px.svg'
import { upload as uploadMap } from '../maps/upload'
import { RaisedButton, TextButton } from '../material/button'
import { fetchJson } from '../network/fetch'
import LoadingIndicator from '../progress/dots'
import {
  amberA400,
  background600,
  colorError,
  colorSuccess,
  colorTextSecondary,
} from '../styles/colors'
import { singleLine, SubheadingOld, subtitle1 } from '../styles/typography'

const Container = styled.div`
  max-width: 600px;
  padding: 0 16px;
  overflow-y: auto;
`

const SelectedFiles = styled.ul`
  margin: 8px 0;
  padding: 8px 0;
  background-color: ${background600};
  border-radius: 8px;
`

const SelectedFileEntry = styled.li`
  ${singleLine};

  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  height: 48px;
  font-size: 16px;
  padding: 0 16px;
`

const FileName = styled.span`
  ${singleLine};
`

const StatusContainer = styled.div`
  margin-left: 16px;
`

const StyledSuccessIcon = styled(SuccessIcon)`
  color: ${colorSuccess};
`

const StyledErrorIcon = styled(ErrorIcon)`
  color: ${colorError};
`

const Underline = styled.div`
  ${subtitle1};
  color: ${colorTextSecondary};
`

const ErrorText = styled(SubheadingOld)`
  color: ${colorError};
`

const WarningText = styled(SubheadingOld)`
  color: ${amberA400};
`

const UPLOAD_STATUS_PENDING = 0
const UPLOAD_STATUS_UPLOADING = 1
const UPLOAD_STATUS_SUCCESS = 2
const UPLOAD_STATUS_ERROR = 3

@form()
class UploadForm extends React.Component {
  render() {
    const { onSubmit, bindCustom } = this.props
    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <FileInput
          {...bindCustom('files')}
          multiple={true}
          accept={'.scm,.scx'}
          onFilesCleared={this.onFilesCleared}
        />
      </form>
    )
  }

  onFilesCleared = () => {
    this.props.setInputValue('files', '')
    if (this.props.onCleared) {
      this.props.onCleared()
    }
  }
}

class UploadStatus extends React.PureComponent {
  getStatusComponent() {
    switch (this.props.status) {
      case UPLOAD_STATUS_UPLOADING:
        return <LoadingIndicator />
      case UPLOAD_STATUS_SUCCESS:
        return <StyledSuccessIcon />
      case UPLOAD_STATUS_ERROR:
        return <StyledErrorIcon />
      default:
        return null
    }
  }

  render() {
    return <StatusContainer>{this.getStatusComponent()}</StatusContainer>
  }
}

@connect(state => ({ auth: state.auth }))
export default class MapManager extends React.Component {
  state = {
    selectedFiles: new List(),
    results: new Map(),
    areYouSure: false,
    isDeleting: false,
    deleteError: null,
  }
  _form = null
  _setForm = elem => {
    this._form = elem
  }

  // TODO(2Pac): This should probably be moved to the FileInput component itself and made more
  // controllable
  renderSelectedFiles() {
    const { selectedFiles: files, results } = this.state
    if (!files.size) return null

    return (
      <SelectedFiles>
        {files.map(file => {
          const result = results.get(file.path)
          return (
            <SelectedFileEntry key={file.path}>
              <FileName>{file.name}</FileName>
              {result !== UPLOAD_STATUS_PENDING ? <UploadStatus status={result} /> : null}
            </SelectedFileEntry>
          )
        })}
      </SelectedFiles>
    )
  }

  renderUploadMaps() {
    const {
      auth: { permissions: perms },
    } = this.props

    if (!perms.manageMaps) return null

    const { selectedFiles, results } = this.state
    const model = {
      files: '',
    }

    const disableUploadButton = results.some(r => r !== UPLOAD_STATUS_PENDING)
    return (
      <>
        <Underline>Select maps to upload</Underline>
        <UploadForm
          ref={this._setForm}
          model={model}
          onSubmit={this.onSubmit}
          onChange={this.onFormChange}
          onCleared={this.onFilesRemoved}
        />
        {this.renderSelectedFiles()}
        {selectedFiles.size ? (
          <RaisedButton
            label='Upload'
            disabled={disableUploadButton}
            onClick={this.onUploadClick}
          />
        ) : null}
      </>
    )
  }

  renderDeleteMaps() {
    const {
      auth: { permissions: perms },
    } = this.props

    if (!perms.massDeleteMaps) return null

    const { areYouSure, isDeleting, deleteError } = this.state
    return (
      <>
        <Underline>Delete all maps</Underline>
        <RaisedButton
          label='Delete all maps'
          disabled={isDeleting}
          onClick={() => this.setState({ areYouSure: true })}
        />
        {areYouSure ? (
          <div>
            <WarningText>
              WARNING! This action will delete all maps in the database and their respective files.
              This cannot be reversed.
            </WarningText>
            <p>Are you sure?</p>
            <TextButton
              label='No'
              color='accent'
              onClick={() => this.setState({ areYouSure: false })}
            />
            <TextButton label='Yes' color='accent' onClick={this.onDeleteMapsClick} />
          </div>
        ) : null}
        {isDeleting ? <LoadingIndicator /> : null}
        {deleteError ? <ErrorText>Something went wrong: {deleteError.message}</ErrorText> : null}
      </>
    )
  }

  render() {
    return (
      <Container>
        {this.renderUploadMaps()}
        {this.renderDeleteMaps()}
      </Container>
    )
  }

  onFormChange = () => {
    const { files } = this._form.getModel()

    const initialUploadStatus = Array.from(files).map(file => [file.path, UPLOAD_STATUS_PENDING])
    this.setState({ selectedFiles: new List(files), results: new Map(initialUploadStatus) })
  }

  onFilesRemoved = () => {
    this.setState({ selectedFiles: new List(), results: new Map() })
  }

  onUploadClick = () => {
    this._form.submit()
  }

  _doUpload = async path => {
    let status
    try {
      await uploadMap(path, '/api/1/maps/official')
      status = UPLOAD_STATUS_SUCCESS
    } catch (e) {
      console.dir(e.body && e.body.error)
      status = UPLOAD_STATUS_ERROR
    }

    this.setState({
      results: this.state.results.set(path, status),
    })
  }

  onSubmit = () => {
    const { files } = this._form.getModel()

    const uploadingStatus = Array.from(files).map(file => [file.path, UPLOAD_STATUS_UPLOADING])
    this.setState({ results: new Map(uploadingStatus) })
    for (const { path } of files) {
      // Upload stuff in parallel
      this._doUpload(path)
    }
  }

  onDeleteMapsClick = async () => {
    this.setState({ areYouSure: false, isDeleting: true, deleteError: null })

    try {
      await fetchJson('/api/1/maps/', { method: 'DELETE' })
      this.setState({ isDeleting: false })
    } catch (err) {
      this.setState({ isDeleting: false, deleteError: err })
    }
  }
}
