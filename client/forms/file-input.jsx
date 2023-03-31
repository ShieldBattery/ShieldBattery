import React from 'react'
import styled from 'styled-components'
import ClearIcon from '../icons/material/clear-24px.svg'
import { IconButton } from '../material/button'
import { useTranslation } from 'react-i18next'

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

    const hasFiles = this.props.value && (!this.multiple || this.props.value.length)
    const { t } = useTranslation()
    return (
      <Container>
        <input ref={this._setInput} {...internalInputProps} />
        {hasFiles ? (
          <ClearButton icon={<ClearIcon />} title={t('common.clearFiles', 'Clear files')} onClick={this.onClearClick} />
        ) : null}
      </Container>
    )
  }

  onInputChange = e => {
    if (this.props.onChange) {
      this.props.onChange(this.props.multiple ? e.target.files : e.target.files[0])
    }
  }

  onClearClick = e => {
    this._input.value = ''
    if (this.props.onFilesCleared) {
      this.props.onFilesCleared()
    }
    if (this.props.onChange) {
      this.props.onChange(this.props.multiple ? [] : undefined)
    }
  }
}
