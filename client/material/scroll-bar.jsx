import React, { PropTypes } from 'react'
import { Scrollbars } from 'react-custom-scrollbars'
import styles from './scroll-bar.css'

function renderTrackHorizontal({ style }) {
  return <div className={styles.trackHorizontal} style={style} />
}

function renderTrackVertical({ style }) {
  return <div className={styles.trackVertical} style={style} />
}

function renderThumbHorizontal({ style }) {
  return <div className={styles.thumbHorizontal} style={style} />
}

function renderThumbVertical({ style }) {
  return <div className={styles.thumbVertical} style={style} />
}

export class ScrollableContent extends React.Component {
  static propTypes = {
    className: PropTypes.string,
    viewClassName: PropTypes.string,
    onUpdate: PropTypes.func,
    autoHeight: PropTypes.bool,
    autoHeightMin: PropTypes.oneOfType([
      PropTypes.number,
      PropTypes.string,
    ]),
    autoHeightMax: PropTypes.oneOfType([
      PropTypes.number,
      PropTypes.string,
    ]),
    // Whether the element should keep the scroll position at the bottom if it's at the bottom and
    // more content is added
    autoScroll: PropTypes.bool,
  };

  constructor(props) {
    super(props)
    this._renderView = ({ children, style }) =>
      <div className={this.props.viewClassName} style={style}>{children}</div>

    this._scrollBars = null
    this._setScrollBarsRef = elem => { this._scrollBars = elem }
    this._shouldAutoScroll = true

    this._handleMouseEnter = ::this.onMouseEnter
    this._handleMouseLeave = ::this.onMouseLeave
  }

  componentWillUpdate() {
    const node = this._scrollBars
    this._shouldAutoScroll =
      (node.getScrollTop() + node.getClientHeight()) >= node.getScrollHeight()
  }

  componentDidMount() {
    this.maybeScrollToBottom()
  }

  componentDidUpdate() {
    this.maybeScrollToBottom()
  }

  maybeScrollToBottom() {
    if (this._shouldAutoScroll && this.props.autoScroll) {
      this._scrollBars.scrollToBottom()
    }
  }

  render() {
    return (
      <Scrollbars
          ref={this._setScrollBarsRef}
          className={this.props.className}
          renderView={this._renderView}
          renderTrackHorizontal={renderTrackHorizontal}
          renderTrackVertical={renderTrackVertical}
          renderThumbHorizontal={renderThumbHorizontal}
          renderThumbVertical={renderThumbVertical}
          hideTracksWhenNotNeeded={true}
          autoHeight={this.props.autoHeight}
          autoHeightMin={this.props.autoHeightMin}
          autoHeightMax={this.props.autoHeightMax}
          onUpdate={this.props.onUpdate}
          onMouseEnter={this._handleMouseEnter}
          onMouseLeave={this._handleMouseLeave}>
        {this.props.children}
      </Scrollbars>
    )
  }
}
