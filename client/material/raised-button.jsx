import React from 'react'
import PropTypes from 'prop-types'
import classnames from 'classnames'
import Button from './button.jsx'
import styles from './button.css'

// A button that has elevation, and raises further when pressed
export default class RaisedButton extends React.Component {
  static propTypes = {
    ...Button.propTypes,
    color: PropTypes.oneOf(['primary', 'accent']),
  }

  constructor(props) {
    super(props)
  }

  render() {
    const classes = classnames(styles.raised, this.props.className, {
      [styles.primary]: this.props.color !== 'accent',
      [styles.accent]: this.props.color === 'accent',
    })

    return <Button {...this.props} className={classes} />
  }
}
