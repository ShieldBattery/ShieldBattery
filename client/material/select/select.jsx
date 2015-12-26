import React from 'react'
import FontIcon from '../font-icon.jsx'
import styles from './select.css'

class Select extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      isOpened: false,
      value: props.defaultValue,
      overlayPosition: null
    }

    this._positionNeedsUpdating = false
  }

  componentDidMount() {
    this.setOverlayPosition(this.refs.value)
  }

  componentWillReceiveProps() {
    this._positionNeedsUpdating = true
  }

  componentDidUpdate() {
    if (this._positionNeedsUpdating) {
      this._positionNeedsUpdating = false
      this.setOverlayPosition(this.refs.value)
    }
  }

  setOverlayPosition(element) {
    const rect = element.getBoundingClientRect()
    const overlayPosition = {
      top: rect.top,
      left: rect.left,
    }

    // Calling setState in componentDidMount is not recommended, but it's the only place we're sure
    // that the DOM element exists, so we can get its position
    this.setState({ overlayPosition })
  }

  render() {
    const content = this.state.isOpened ? this.renderOverlay() : this.renderSelect()

    return <div>{content}</div>
  }

  renderSelect() {
    let displayValue = ''
    React.Children.forEach(this.props.children, child => {
      if (this.state.value === child.props.value) {
        displayValue = child.props.text
        return
      }
    })

    return (<div className={styles.select} onClick={::this.onOpen}>
      <span className={styles.value} ref='value'>{displayValue}</span>
      <span className={styles.icon}><FontIcon>arrow_drop_down</FontIcon></span>
    </div>)
  }

  renderOverlay() {
    const overlayStyle = {
      // Subtract the padding so the select-option perfectly overlaps with select-value
      top: (this.state.overlayPosition.top - 22) + 'px',
      left: (this.state.overlayPosition.left - 16) + 'px'
    }

    const options = React.Children.map(this.props.children, child => {
      return React.cloneElement(child, {
        onOptionChange: () => this.onOptionChanged(child.props.value)
      })
    })

    return [<div key='overlay' className={styles.overlay} style={overlayStyle}>
        {options}
      </div>,
      <div key='backdrop' className={styles.backdrop} onClick={::this.onClose} />]
  }

  onOpen() {
    this.setState({ isOpened: true })
  }

  onClose() {
    this.setState({ isOpened: false })
  }

  onOptionChanged(value) {
    this.setState({ value, isOpened: false })
  }
}

export default Select
