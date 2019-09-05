import { List, Map } from 'immutable'
import React from 'react'
import styled from 'styled-components'

import form from '../forms/form.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import uploadMap from '../maps/upload'
import RaisedButton from '../material/raised-button.jsx'
import FileInput from '../forms/file-input.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'

import ErrorIcon from '../icons/material/ic_close_black_24px.svg'
import SuccessIcon from '../icons/material/baseline-check_circle-24px.svg'

import { colorError, colorSuccess, colorTextSecondary, grey800 } from '../styles/colors'
import { Subheading, singleLine } from '../styles/typography'

const Container = styled.div`
  max-width: 600px;
  padding: 0 16px;
`

const SelectedFiles = styled.ul`
  margin: 8px 0;
  padding: 8px 0;
  background-color: ${grey800};
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

const Underline = styled(Subheading)`
  color: ${colorTextSecondary};
`

const UPLOAD_STATUS_PENDING = 0
const UPLOAD_STATUS_UPLOADING = 1
const UPLOAD_STATUS_SUCCESS = 2
const UPLOAD_STATUS_ERROR = 3

@form()
class UploadForm extends React.Component {
  render() {
    const { onSubmit, bindCustom, onChange } = this.props
    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <FileInput
          {...bindCustom('files')}
          multiple={true}
          accept={'.scm,.scx'}
          onFilesAdded={onChange}
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

export default class UploadMap extends React.Component {
  state = {
    selectedFiles: new List(),
    results: new Map(),
  }
  _form = null
  _setForm = elem => {
    this._form = elem
  }

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

  render() {
    const { selectedFiles, results } = this.state
    const model = {
      files: '',
    }

    const disableUploadButton = results.some(r => r !== UPLOAD_STATUS_PENDING)
    return (
      <ScrollableContent>
        <Container>
          <Underline>Select maps to upload</Underline>
          <UploadForm
            ref={this._setForm}
            model={model}
            onSubmit={this.onSubmit}
            onChange={this.onFilesSelected}
            onCleared={this.onFilesRemoved}
          />
          {this.renderSelectedFiles()}
          {selectedFiles.size ? (
            <RaisedButton label='Upload' disabled={disableUploadButton} onClick={this.onClick} />
          ) : null}
        </Container>
      </ScrollableContent>
    )
  }

  onFilesSelected = files => {
    const initialUploadStatus = Array.from(files).map(file => [file.path, UPLOAD_STATUS_PENDING])
    this.setState({ selectedFiles: new List(files), results: new Map(initialUploadStatus) })
  }

  onFilesRemoved = () => {
    this.setState({ selectedFiles: new List(), results: new Map() })
  }

  onClick = () => {
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
}
