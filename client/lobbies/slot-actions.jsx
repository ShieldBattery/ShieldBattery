import React from 'react'
import PropTypes from 'prop-types'

import IconButton from '../material/icon-button'
import Menu from '../material/menu/menu'
import MenuItem from '../material/menu/item'
import SlotActionsIcon from '../icons/material/ic_more_vert_black_24px.svg'

export default class SlotActions extends React.Component {
  static propTypes = {
    slotActions: PropTypes.array,
  }

  state = {
    slotActionsOverlayOpen: false,
  }

  _slotActionsButtonRef = React.createRef()

  render() {
    const { slotActions } = this.props
    const actions = slotActions.map(([text, handler], i) => (
      <MenuItem key={i} text={text} onClick={() => this.onActionClick(handler)} />
    ))

    return (
      <div>
        <IconButton
          icon={<SlotActionsIcon />}
          title='Slot actions'
          buttonRef={this._slotActionsButtonRef}
          onClick={this.onOpenSlotActionsOverlay}
        />
        <Menu
          open={this.state.slotActionsOverlayOpen}
          onDismiss={this.onCloseSlotActionsOverlay}
          anchor={this._slotActionsButtonRef.current}
          anchorOriginVertical='top'
          anchorOriginHorizontal='right'
          popoverOriginVertical='top'
          popoverOriginHorizontal='right'>
          {actions}
        </Menu>
      </div>
    )
  }

  onOpenSlotActionsOverlay = type => {
    this.setState({
      slotActionsOverlayOpen: true,
    })
  }

  onCloseSlotActionsOverlay = () => {
    this.setState({
      slotActionsOverlayOpen: false,
    })
  }

  onActionClick = handler => {
    handler()
    this.onCloseSlotActionsOverlay()
  }
}
