import React, { PropTypes } from 'react'
import TransitionGroup from 'react-addons-css-transition-group'
import styles from './menu.css'
import menuUtilsStyles from './common/menu-utils.css'

import IconButton from './icon-button.jsx'
import { MenuOverlay, MenuBackdrop } from './common/menu-utils.jsx'

const transitionNames = {
  enter: menuUtilsStyles.enter,
  enterActive: menuUtilsStyles.enterActive,
  leave: menuUtilsStyles.leave,
  leaveActive: menuUtilsStyles.leaveActive,
}

const VERT_PADDING = 8
const OPTION_HEIGHT = 48

class Menu extends React.Component {
  static propTypes = {
    element: PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.element,
    ]).isRequired,
    origin: PropTypes.object,
  };

  static defaultProps = {
    origin: { horizontal: 'left', vertical: 'top' },
  };

  constructor(props) {
    super(props)
    this.state = {
      isOpened: false,
      overlayPosition: null,
      activeIndex: -1,
    }

    this._openHandler = ::this.onOpen
    this._closeHandler = ::this.onClose
    this._handleMouseMove = ::this.onMouseMove

    this._overlayTop = 0
    this._lastMouseY = -1
  }

  calculateOverlayPosition() {
    const rect = this.refs.element.getBoundingClientRect()
    const overlayPosition = {
      top: rect.top,
      left: rect.left,
    }

    return overlayPosition
  }

  getOverlayRef() {
    if (this.refs.overlay) return this.refs.overlay.refs.overlay
  }

  renderIconButton(iconName) {
    return <IconButton icon='more_vert' onClick={this._openHandler} />
  }

  renderMenu() {
    if (!this.state.isOpened) return null

    const pos = this.state.overlayPosition
    const horizontal = this.props.origin.horizontal
    const vertical = this.props.origin.vertical

    let overlayStyle
    if (horizontal === 'left' && vertical === 'top') {
      overlayStyle = {
        top: pos.top,
        left: pos.left,
      }
    } else if (horizontal === 'right' && vertical === 'top') {
      overlayStyle = {
        top: pos.top,
        left: pos.left - 156 + 64,
      }
    } else if (horizontal === 'left' && vertical === 'bottom') {
      overlayStyle = {
        top: pos.top - 208 + 48,
        left: pos.left,
      }
    } else if (horizontal === 'right' && vertical === 'bottom') {
      overlayStyle = {
        top: pos.top - 208 + 48,
        left: pos.left - 156 + 64,
      }
    }
    this._overlayTop = overlayStyle.top

    const options = React.Children.map(this.props.children, (child, i) => {
      return React.cloneElement(child, {
        active: i === this.state.activeIndex,
        closeMenu: this._closeHandler,
      })
    })

    return [
      <MenuBackdrop key='backdrop' onBackdropClicked={this._closeHandler} />,
      <MenuOverlay key='overlay' ref='overlay' style={overlayStyle}
          onMouseMove={this._handleMouseMove}>
        {options}
      </MenuOverlay>
    ]
  }

  render() {
    const { element } = this.props
    const menuElem = typeof element === 'string' ? this.renderIconButton(element) :
      React.cloneElement(element, {
        onClick: this._openHandler,
      })

    return (
        <div ref='element' className={styles.menu}>
          <TransitionGroup transitionName={transitionNames} className={this.props.className}
              transitionEnterTimeout={200} transitionLeaveTimeout={200}>
            { menuElem }
            { this.renderMenu() }
          </TransitionGroup>
        </div>
    )
  }

  onMouseMove(event) {
    if (event.clientY === this._lastMouseY) {
      // mouse move must have been caused by a scroll (but the mouse didn't actually move),
      // ignore it
      return
    }

    this._lastMouseY = event.clientY
    let localY = event.clientY - (this._overlayTop + VERT_PADDING)
    localY += this.getOverlayRef().scrollTop
    const numOptions = React.Children.count(this.props.children)
    const itemIndex = Math.min(numOptions - 1, Math.max(0, Math.floor(localY / OPTION_HEIGHT)))
    if (itemIndex !== this.state.activeIndex) {
      this.setState({
        activeIndex: itemIndex,
      })
    }
  }

  onOpen() {
    this.setState({
      isOpened: true,
      overlayPosition: this.calculateOverlayPosition(),
    })
  }

  onClose() {
    this.setState({ isOpened: false })
  }
}

export default Menu
