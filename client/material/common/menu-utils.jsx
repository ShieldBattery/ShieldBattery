import React, { PropTypes } from 'react'
import styles from './menu-utils.css'

export class MenuOverlay extends React.Component {
  static propTypes = {
    style: PropTypes.object,
    onMouseMove: PropTypes.func,
  };

  render() {
    return (
      <div ref='overlay' className={styles.overlay} style={this.props.style}
          onMouseMove={this.props.onMouseMove}>
        { this.props.children }
      </div>
    )
  }
}

export class MenuItem extends React.Component {
  static propTypes = {
    text: PropTypes.string.isRequired,
    value: PropTypes.any,
    active: PropTypes.bool,
    onOptionSelected: PropTypes.func,
    onClick: PropTypes.func,
    closeMenu: PropTypes.func,
  };

  constructor(props) {
    super(props)
    this._clickHandler = ::this.onClick
  }

  render() {
    const className = styles.menuItem + (this.props.active ? ' ' + styles.active : '')

    return (
      <div className={className} onClick={this._clickHandler}>
        <span className={styles.menuItemText}>
          { this.props.text }
        </span>
      </div>
    )
  }

  onClick() {
    if (this.props.onClick) {
      this.props.onClick()
      this.props.closeMenu()
    } else if (this.props.value && this.props.onOptionSelected) {
      this.props.onOptionSelected(this.props.value)
    }
  }
}

export class MenuBackdrop extends React.Component {
  static propTypes = {
    onBackdropClicked: PropTypes.func,
  };

  render() {
    return <div className={styles.backdrop} onClick={this.props.onBackdropClicked} />
  }
}
