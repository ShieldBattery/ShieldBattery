import React from 'react'
import { connect } from 'react-redux'
import form from '../forms/form.jsx'
import FileInput from '../forms/file-input.jsx'
import RaisedButton from '../material/raised-button.jsx'
import TextField from '../material/text-field.jsx'
import ContentLayout from '../content/content-layout.jsx'
import styles from './patch-upload.css'

import fetch from '../network/fetch'
import HashThrough from '../../app/common/hash-through'
import { streamEndPromise } from '../../app/common/async/stream-promise'
import fileReaderStream from 'filereader-stream'
import { openSnackbar } from '../snackbars/action-creators'

async function uploadPatch(binaryFile, diffFile, filename, description) {
  const hasher = new HashThrough()
  const binaryStream = fileReaderStream(binaryFile)
  const binaryStreamPromise = streamEndPromise(binaryStream)
  binaryStream.pipe(hasher)
  hasher.resume()

  const [hash, ] = await Promise.all([hasher.hashPromise, binaryStreamPromise])

  const formData = new FormData()
  formData.append('hash', hash)
  formData.append('diff', diffFile)
  formData.append('filename', filename)
  formData.append('description', description)

  return fetch('/api/1/patches', { method: 'post', body: formData })
}

@form()
class PatchUploadForm extends React.Component {
  render() {
    const { onSubmit, bindCustom, bindInput } = this.props
    return (<form noValidate={true} onSubmit={onSubmit}>
      <div className={styles.field}>
        <h5>Binary (updated file itself):</h5>
        <FileInput {...bindCustom('binary')} accept={'.exe,.dll'}/>
      </div>
      <div className={styles.field}>
        <h5>Diff (generate with bsdiff):</h5>
        <FileInput {...bindCustom('diff')} />
      </div>
      <div className={styles.field}>
        <TextField {...bindInput('filename')} label='Filename' floatingLabel={true}
          inputProps={{
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
          }}/>
      </div>
      <div className={styles.field}>
        <TextField {...bindInput('description')} label='Version description' floatingLabel={true}
          inputProps={{
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
          }}/>
      </div>

      <RaisedButton label={'Upload'} onClick={onSubmit} />
    </form>)
  }
}

@connect()
export default class PatchUpload extends React.Component {
  render() {
    return (<ContentLayout title={'Upload StarCraft patch'}>
      <div className={styles.content}>
        <p>Generate a diff to patch from the new binary to the old (1.16.1) one using bsdiff, then
          upload the binary and the diff here. Filename is case insensitive but should match the
          target filename exactly (<i>starcraft.exe</i> or <i>storm.dll</i> for example). Version
          description is for human consumption, usually it should be the version the file says it is
          (i.e. <i>1.18.0.1345</i>).</p>

        <PatchUploadForm model={{}} onSubmit={this.onSubmit} />
      </div>
    </ContentLayout>)
  }

  onSubmit = async form => {
    const { dispatch } = this.props
    const model = form.getModel()
    try {
      await uploadPatch(model.binary[0], model.diff[0], model.filename, model.description)
    } catch (err) {
      dispatch(openSnackbar({ message: 'Error uploading patch: ' + err.message }))
      return
    }

    form.reset()
    dispatch(openSnackbar({ message: 'Patch uploaded!' }))
  }
}
