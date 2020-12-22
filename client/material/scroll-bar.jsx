import React from 'react'
import PropTypes from 'prop-types'
import { Scrollbars } from 'react-custom-scrollbars'
import styled from 'styled-components'

import { grey700, grey800, grey900, CardLayer } from '../styles/colors'

const Track = styled.div`
  background-color: ${grey800};
  border-radius: 2px;
  cursor: pointer;

  ${CardLayer} & {
    background-color: ${grey700};
  }
`

const TrackHorizontal = styled(Track)`
  right: 2px;
  bottom: 2px;
  left: 2px;
  min-height: 12px;
`

const TrackVertical = styled(Track)`
  top: 0px;
  bottom: 0px;
  right: 0px;
  padding-top: 2px;
  padding-bottom: 2px;
  min-width: 12px;
`

const Thumb = styled.div`
  cursor: pointer;
  border-radius: inherit;
  background-color: ${grey900};
`

const ThumbHorizontal = styled(Thumb)`
  height: 100%;
  /* leaves space around the edges but still allows those edges to be draggable */
  border-top: 2px solid ${grey800};
  border-bottom: 2px solid ${grey800};

  ${CardLayer} & {
    border-top-color: ${grey700};
    border-bottom-color: ${grey700};
  }
`

const ThumbVertical = styled(Thumb)`
  width: 100%;
  /* leaves space around the edges but still allows those edges to be draggable */
  border-left: 2px solid ${grey800};
  border-right: 2px solid ${grey800};
  margin-left: auto;
  margin-right: auto;

  ${CardLayer} & {
    border-left-color: ${grey700};
    border-right-color: ${grey700};
  }
`

function renderTrackHorizontal({ style }) {
  return <TrackHorizontal style={style} />
}

function renderTrackVertical({ style }) {
  return <TrackVertical style={style} />
}

function renderThumbHorizontal({ style }) {
  return <ThumbHorizontal style={style} />
}

function renderThumbVertical({ style }) {
  return <ThumbVertical style={style} />
}

export class ScrollableContent extends React.Component {
  static propTypes = {
    viewElement: PropTypes.element,
    onUpdate: PropTypes.func,
    autoHeight: PropTypes.bool,
    autoHeightMin: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    autoHeightMax: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    // Whether the element should keep the scroll position at the bottom if it's at the bottom and
    // more content is added
    autoScroll: PropTypes.bool,
    onScroll: PropTypes.func,
  }

  constructor(props) {
    super(props)
    this._renderView = ({ children, style }) => {
      let viewElement
      if (this.props.viewElement) {
        viewElement = React.cloneElement(this.props.viewElement, {
          style,
          children,
        })
      } else {
        viewElement = <div style={style}>{children}</div>
      }

      return viewElement
    }

    this._scrollBars = null
    this._setScrollBarsRef = elem => {
      this._scrollBars = elem
    }
    this._shouldAutoScroll = true

    this._insertingAtTop = false
    this._lastScrollHeight = 0
  }

  componentWillUpdate() {
    const node = this._scrollBars
    this._lastScrollHeight = node.getScrollHeight()
    this._shouldAutoScroll =
      !this._insertingAtTop &&
      node.getScrollTop() + node.getClientHeight() + 8 /* allow some leeway */ >=
        this._lastScrollHeight
  }

  componentDidMount() {
    this.maybeAutoScroll()
  }

  componentDidUpdate() {
    this.maybeAutoScroll()
    this.maybeMaintainScrollPos()
  }

  maybeAutoScroll() {
    if (this._shouldAutoScroll && this.props.autoScroll) {
      this._scrollBars.scrollToBottom()
    }
  }

  maybeMaintainScrollPos() {
    if (!this._insertingAtTop) {
      return
    }

    const scrollHeight = this._scrollBars.getScrollHeight()
    if (scrollHeight === this._lastScrollHeight) {
      return
    }

    // adjust scrollTop by the difference between old scroll height and new scroll height, to
    // maintain the same top element
    this._scrollBars.scrollTop(
      this._scrollBars.getScrollTop() + (scrollHeight - this._lastScrollHeight),
    )
  }

  // Set a flag that indicates whether or not we are inserting content at the top of the scrollable
  // content. This allows us to better decide how to adjust scroll position (e.g. to try and keep
  // the same top element visible or not)
  setInsertingAtTop(insertingAtTop) {
    this._insertingAtTop = insertingAtTop
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
        onScroll={this._handleScroll}>
        {this.props.children}
      </Scrollbars>
    )
  }

  _handleScroll = event => {
    if (this.props.onScroll) {
      this.props.onScroll(event)
    }
  }

  getClientHeight = () => {
    return this._scrollBars.getClientHeight()
  }

  getClientWidth = () => {
    return this._scrollBars.getClientWidth()
  }

  getScrollHeight = () => {
    return this._scrollBars.getScrollHeight()
  }

  getScrollTop = () => {
    return this._scrollBars.getScrollTop()
  }

  scrollTop = (top = 0) => {
    return this._scrollBars.scrollTop(top)
  }

  scrollToTop = () => {
    return this._scrollBars.scrollToTop()
  }

  scrollToBottom = () => {
    return this._scrollBars.scrollToBottom()
  }
}
