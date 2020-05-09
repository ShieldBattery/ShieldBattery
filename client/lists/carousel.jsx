import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import IconButton from '../material/icon-button.jsx'
import InfiniteScrollList from './infinite-scroll-list.jsx'
import { Label } from '../material/button.jsx'
import WindowListener from '../dom/window-listener.jsx'

import CarouselPrev from '../icons/material/chevron_left-24px.svg'
import CarouselNext from '../icons/material/chevron_right-24px.svg'

import { fastOutSlowIn } from '../material/curve-constants'
import { colorTextSecondary } from '../styles/colors'

const BUTTON_WIDTH = 64
const LOADER_WIDTH = 98

const CarouselContainer = styled.div`
  display: flex;
  align-items: center;
`

const CarouselContentMask = styled.div`
  display: flex;
  flex-grow: 1;
  overflow: hidden;
`

const CarouselContent = styled.div`
  display: flex;
  flex-shrink: 0;
  transition: transform 250ms ${fastOutSlowIn};
`

const CarouselButton = styled(IconButton)`
  flex-shrink: 0;
  margin: 0 8px;

  ${Label} {
    color: ${colorTextSecondary};
  }
`

export default class Carousel extends React.Component {
  static propTypes = {
    isLoading: PropTypes.bool,
    // Whether the carousel has more items that could be requested
    hasMoreItems: PropTypes.bool,
    onLoadMoreData: PropTypes.func,
  }

  state = {
    translateWidth: 0,
    carouselWidth: 0,
    contentWidth: 0,
    stepWidth: 0,
    hasPrevItems: false,
    hasNextItems: false,
  }

  _carouselRef = React.createRef()
  _contentRef = React.createRef()
  _infiniteListRef = React.createRef()
  _animationId = null

  componentDidMount() {
    this._calcCarouselWidth()
  }

  componentDidUpdate(prevProps) {
    const prevCount = React.Children.count(prevProps.children)
    const currCount = React.Children.count(this.props.children)
    if (prevCount !== currCount) {
      this._calcCarouselWidth()
    }
  }

  componentWillUnmount() {
    window.cancelAnimationFrame(this._animationId)
  }

  _calcCarouselWidth = () => {
    const { translateWidth } = this.state
    // This is the width of currently visible items
    let carouselWidth = this._carouselRef.current.getBoundingClientRect().width
    // This is the width of all items in total
    const contentWidth = this._contentRef.current.getBoundingClientRect().width

    const hasPrevItems = translateWidth < 0
    const adjustment = hasPrevItems ? BUTTON_WIDTH : 0
    const hasNextItems = contentWidth - carouselWidth + adjustment > Math.abs(translateWidth)

    if (hasPrevItems && hasNextItems) {
      carouselWidth = carouselWidth - BUTTON_WIDTH * 2 // both prev and next buttons are visible
    } else if (hasPrevItems || hasNextItems) {
      carouselWidth = carouselWidth - BUTTON_WIDTH // only one of the buttons is visible
    }

    // Scroll 60% of the currently visible items
    const stepWidth = carouselWidth * 0.6

    this.setState({ carouselWidth, contentWidth, stepWidth, hasPrevItems, hasNextItems })
  }

  reset() {
    this.setState({ translateWidth: 0 })
    this._infiniteListRef.current.reset()
  }

  render() {
    const { isLoading, hasMoreItems, onLoadMoreData } = this.props
    const { translateWidth, hasPrevItems, hasNextItems } = this.state

    const contentStyle = { transform: `translateX(${translateWidth}px)` }
    // We count the children so we don't show the buttons while the items are loading
    const childrenCount = React.Children.count(this.props.children)

    return (
      <CarouselContainer ref={this._carouselRef} className={this.props.className}>
        <WindowListener event='resize' listener={this._calcCarouselWidth} />
        {hasPrevItems && childrenCount > 0 ? (
          <CarouselButton icon={<CarouselPrev />} title='Previous' onClick={this.onPrev} />
        ) : null}
        <CarouselContentMask>
          <CarouselContent ref={this._contentRef} style={contentStyle}>
            <InfiniteScrollList
              ref={this._infiniteListRef}
              isLoading={isLoading}
              horizontal={true}
              hasMoreData={hasMoreItems}
              onLoadMoreData={onLoadMoreData}>
              {this.props.children}
            </InfiniteScrollList>
          </CarouselContent>
        </CarouselContentMask>
        {hasNextItems && childrenCount > 0 ? (
          <CarouselButton icon={<CarouselNext />} title='Next' onClick={this.onNext} />
        ) : null}
      </CarouselContainer>
    )
  }

  animatePosition = (currentWidth, delta) => {
    const translateWidth = currentWidth + delta

    this.setState({ translateWidth })
    // Width can change due to prev/next button showing/hiding so we need to recalculate it
    this._calcCarouselWidth()
  }

  onPrev = () => {
    const { translateWidth, stepWidth } = this.state

    const delta = translateWidth + stepWidth > 0 ? Math.abs(translateWidth) : stepWidth

    this._animationId = window.requestAnimationFrame(() =>
      this.animatePosition(translateWidth, delta),
    )
  }

  onNext = () => {
    const {
      translateWidth,
      carouselWidth,
      contentWidth,
      stepWidth,
      hasPrevItems,
      hasNextItems,
    } = this.state

    // When we reach the end of the list, we need to adjust the translate width a bit, depending on
    // whether we have more items to load (in which case the loader will be shown), or if we've
    // reached the last page, then nothing will be shown
    let adjustment = 0
    if (this.props.hasMoreItems) {
      adjustment = BUTTON_WIDTH - LOADER_WIDTH
    } else if (hasPrevItems && hasNextItems) {
      adjustment = BUTTON_WIDTH
    }
    const delta =
      Math.abs(translateWidth) + stepWidth + carouselWidth > contentWidth
        ? contentWidth - Math.abs(translateWidth) - carouselWidth - adjustment
        : stepWidth

    this._animationId = window.requestAnimationFrame(() =>
      this.animatePosition(translateWidth, -delta),
    )
  }
}
