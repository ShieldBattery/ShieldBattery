import React, { PropTypes } from 'react'
import styles from './activity-bar.css'

import FontIcon from '../material/font-icon.jsx'

export default class ActivityButton extends React.Component {
  static propTypes = {
    label: PropTypes.string.isRequired,
    icon: PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.element,
    ]).isRequired,
    onClick: PropTypes.func,
  };

  renderFontIcon(iconName) {
    return <FontIcon size={36}>{iconName}</FontIcon>
  }

  render() {
    const { label, icon, onClick } = this.props
    const iconElem = typeof icon === 'string' ? this.renderFontIcon(icon) : icon

    return (<button className={styles.button} onClick={onClick}>
      <div className={styles.buttonIcon}>
        {iconElem}
      </div>
      <span className={styles.buttonLabel}>{label}</span>
    </button>)
  }
}
