import React from 'react'
import { findMatch } from './action-creators'
import { closeOverlay } from '../activities/action-creators'

import Option from '../material/select/option.jsx'
import RaisedButton from '../material/raised-button.jsx'
import ValidatedForm from '../forms/validated-form.jsx'
import ValidatedSelect from '../forms/validated-select.jsx'

export default class FindMatch extends React.Component {
  static contextTypes = {
    store: React.PropTypes.object.isRequired,
  };

  constructor(props) {
    super(props)

    this._handleFindClicked = ::this.onFindClicked
    this._handleSubmitted = ::this.onSubmitted
  }

  render() {
    const buttons = [
      <RaisedButton label='Find' key='find' onClick={this._handleFindClicked} />
    ]

    return (<ValidatedForm ref='form' formTitle={'Find match'} buttons={buttons}
        onSubmitted={this._handleSubmitted}>
      <ValidatedSelect label='Type' name='type' tabIndex={0} defaultValue='1v1ladder'>
        <Option key='1v1' value='1v1ladder' text='1v1 Ladder' />
      </ValidatedSelect>
      <ValidatedSelect label='Race' name='race' tabIndex={0} defaultValue='r'>
        <Option key='z' value='z' text='Zerg' />
        <Option key='p' value='p' text='Protoss' />
        <Option key='t' value='t' text='Terran' />
        <Option key='r' value='r' text='Random' />
      </ValidatedSelect>
    </ValidatedForm>)
  }

  onFindClicked() {
    this.refs.form.trySubmit()
  }

  onSubmitted(values) {
    this.context.store.dispatch(findMatch(values.get('type'), values.get('race')))
    this.context.store.dispatch(closeOverlay())
  }
}
