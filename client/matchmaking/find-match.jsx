import React from 'react'
import { connect } from 'react-redux'
import { findMatch } from './action-creators'
import { closeOverlay } from '../activities/action-creators'
import styles from './find-match.css'

import Option from '../material/select/option.jsx'
import RaisedButton from '../material/raised-button.jsx'
import Select from '../material/select/select.jsx'
import form from '../forms/form.jsx'
import SubmitOnEnter from '../forms/submit-on-enter.jsx'

@form()
class FindMatchForm extends React.Component {
  render() {
    const { onSubmit, bindCustom } = this.props

    return (<form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />
      <Select {...bindCustom('type')} label='Type' tabIndex={0}>
        <Option key='1v1' value='1v1ladder' text='1v1 Ladder' />
      </Select>
      <Select {...bindCustom('race')} label='Race' tabIndex={0}>
        <Option key='z' value='z' text='Zerg' />
        <Option key='p' value='p' text='Protoss' />
        <Option key='t' value='t' text='Terran' />
        <Option key='r' value='r' text='Random' />
      </Select>

      <RaisedButton label='Find' onClick={onSubmit} />
    </form>)
  }
}

@connect()
export default class FindMatch extends React.Component {
  render() {
    const model = {
      type: '1v1ladder',
      race: 'r',
    }

    return (<div className={styles.root}>
      <h3>Find match</h3>
      <FindMatchForm model={model} onSubmit={this.onSubmit} />
    </div>)
  }

  onSubmit = async form => {
    const { dispatch } = this.props
    const { type, race } = form.getModel()

    dispatch(findMatch(type, race))
    dispatch(closeOverlay())
  }
}
