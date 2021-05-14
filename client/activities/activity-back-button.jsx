import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { goBack } from '../activities/action-creators'
import BackIcon from '../icons/material/baseline-arrow_back-24px.svg'
import IconButton from '../material/icon-button'

const BackButton = styled(IconButton)`
  margin-right: 16px;
`

@connect(state => ({ activityOverlay: state.activityOverlay }))
export default class ActivityBackButton extends React.Component {
  hasBeenRendered = false
  shouldShow = true

  render() {
    const { activityOverlay } = this.props

    // We only check to see if the back button should display on the first render, and keep it from
    // then on. This assumes that the back stack cannot change without the ActivityOverlay content
    // changing, which seems to be an accurate assumption. By doing it this way, we prevent the
    // back button from disappearing during transitions (e.g. if you click off the overlay)
    if (!this.hasBeenRendered) {
      this.shouldShow = activityOverlay.history.size >= 2
      this.hasBeenRendered = true
    }

    return this.shouldShow ? (
      <BackButton icon={<BackIcon />} title='Back' onClick={this.onBackClick} />
    ) : null
  }

  onBackClick = () => {
    this.props.dispatch(goBack())
  }
}
