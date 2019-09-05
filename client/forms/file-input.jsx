import React from 'react'
import styled from 'styled-components'

import IconButton from '../material/icon-button.jsx'

import ClearIcon from '../icons/material/baseline-clear-24px.svg'

// TODO(tec27): Make a Material file upload component and move this into the material/ folder

const Container = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  height: 48px;
`

const ClearButton = styled(IconButton)`
  margin-left: 16px;
`

// Quick and ugly wrap for <input type='file'> that works with rest of the form stuff
export default class FileInput extends React.Component {
  _input = null
  _setInput = elem => {
    this._input = elem
  }

  render() {
    const internalInputProps = {
      type: 'file',
      accept: this.props.accept,
      multiple: this.props.multiple,
      onChange: this.onInputChange,
    }

    return (
      <Container>
        <input ref={this._setInput} {...internalInputProps} />
        {this.props.value ? (
          <ClearButton icon={<ClearIcon />} title='Clear files' onClick={this.onClearClick} />
        ) : null}
      </Container>
    )
  }

  onInputChange = e => {
    if (this.props.onChange) {
      this.props.onChange(e.target.files)
    }
    if (this.props.onFilesAdded) {
      this.props.onFilesAdded(e.target.files)
    }
  }

  onClearClick = e => {
    this._input.value = ''
    if (this.props.onFilesCleared) {
      this.props.onFilesCleared()
    }
  }
}
