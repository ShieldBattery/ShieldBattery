import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'

import { goBack } from '../activities/action-creators'

import IconButton from '../material/icon-button.jsx'

import BackIcon from '../icons/material/baseline-arrow_back-24px.svg'

const BackButton = styled(IconButton)`
  margin-right: 16px;
`

@connect(state => ({ activityOverlay: state.activityOverlay }))
export default class ActivityBackButton extends React.Component {
  render() {
    const { activityOverlay } = this.props

    if (activityOverlay.history.size < 2) return null

    return <BackButton icon={<BackIcon />} title='Back' onClick={this.onBackClick} />
  }

  onBackClick = () => {
    this.props.dispatch(goBack())
  }
}
