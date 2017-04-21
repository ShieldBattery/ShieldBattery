import React from 'react'

// TODO(tec27): Make a Material file upload component and move this into the material/ folder

// Quick and ugly wrap for <input type='file'> that works with rest of the form stuff
export default class FileInput extends React.Component {
  render() {
    const internalInputProps = {
      type: 'file',
      accept: this.props.accept,
      multiple: this.props.multiple,
      onChange: this.onInputChange,
    }

    return (
      <input {...internalInputProps} />
    )
  }

  onInputChange = e => {
    if (this.props.onChange) {
      this.props.onChange(e.target.files)
    }
  }
}
