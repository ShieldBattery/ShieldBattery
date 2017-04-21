import { List, } from 'immutable'
import React from 'react'
import ContentLayout from '../content/content-layout.jsx'
import form from '../forms/form.jsx'
import uploadMap from '../maps/upload'
import RaisedButton from '../material/raised-button.jsx'
import FileInput from '../forms/file-input.jsx'

@form()
class UploadForm extends React.Component {
  render() {
    const { onSubmit, bindCustom } = this.props
    return (<form noValidate={true} onSubmit={onSubmit}>
      <FileInput {...bindCustom('files')} multiple={true} accept={'.scm,.scx'}/>
    </form>)
  }
}

// This component won't actually do anything regular users can't,
// it's just not really useful for them.
export default class UploadMap extends React.Component {
  state = {
    results: new List(),
  };
  _form = null;

  renderResult() {
    const results = this.state.results.entrySeq().map(([idx, val]) => (<div key={idx}>{val}</div>))
    return (<div>{results}</div>)
  }

  render() {
    const model = {
      files: '',
    }
    return (
      <ContentLayout title={'Map upload'}>
        <UploadForm ref={x => { this._form = x }} model={model} onSubmit={this.onSubmit} />
        <RaisedButton label='Upload' tabIndex={0} onClick={this.onClick} />
        { this.renderResult() }
      </ContentLayout>
    )
  }

  onClick = () => {
    this._form.submit()
  };

  onSubmit = async () => {
    const { files } = this._form.getModel()
    for (const { path } of files) {
      this.setState({
        results: this.state.results.push(`Uploading ${path}...`),
      })

      let msg
      try {
        await uploadMap(path)
        msg = `${path} uploaded successfully!`
      } catch (e) {
        msg = `Could not upload ${path}: ${e.message}`
      }
      this.setState({
        results: this.state.results.push(msg),
      })
    }
  };
}
