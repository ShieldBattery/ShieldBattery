import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import LoadingIndicator from '../progress/dots'

const LoadingArea = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  min-height: 56px;
  padding: 16px 0;
`

// A component that implements the functionality of an infinite scrolling lists, by wrapping the
// `IntersectionObserver` API, which provides a way to asynchronously observe changes in the
// intersection of a target element with an ancestor element.
// NOTE(2Pac): This component currently has two limitations that need to be mindful of:
//    1) The initial amount of loaded items need to have enough height to cause the scrollbar to
//       show, otherwise it won't be possible to trigger the intersection callback a second time.
//    2) If the newly loaded items don't increase the height of the list (by putting items in a
//       row for example), it won't be possible to load more items from that point on.
// TODO(2Pac): Support inserting content at the top of the list as well
export default class InfiniteList extends React.Component {
  static propTypes = {
    isLoading: PropTypes.bool,
    horizontal: PropTypes.bool,
    // Whether the list has more data that could be requested
    hasMoreData: PropTypes.bool,
    root: PropTypes.node,
    rootMargin: PropTypes.string,
    threshold: PropTypes.oneOfType([PropTypes.number, PropTypes.arrayOf(PropTypes.number)]),
    onLoadMoreData: PropTypes.func,
  }

  static defaultProps = {
    root: null, // Means that the viewport will be used as a root origin
    rootMargin: '0px',
    threshold: 0, // As soon as one pixel is visible, the callback will be run
  }

  observer = null

  target = null
  _setTargetRef = elem => {
    this.target = elem
  }

  componentDidMount() {
    const { root, rootMargin, threshold } = this.props

    this.observer = new IntersectionObserver(this.onIntersection, {
      root,
      rootMargin,
      threshold,
    })
    this.observer.observe(this.target)
  }

  componentWillUnmount() {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
  }

  // This function allows the use case of using the same instance of the infinite scroll list
  // multiple times inside another component; eg. common when using it with tabs.
  reset() {
    if (this.observer) {
      this.observer.disconnect()
      this.observer.observe(this.target)
    }
  }

  render() {
    const { isLoading } = this.props

    return (
      <>
        {this.props.children}
        <LoadingArea ref={this._setTargetRef}>
          {isLoading ? <LoadingIndicator /> : null}
        </LoadingArea>
      </>
    )
  }

  onIntersection = (entries, observer) => {
    if (!this.props.onLoadMoreData) return

    entries.forEach(entry => {
      if (entry.isIntersecting && this.props.hasMoreData) {
        this.props.onLoadMoreData()
      }
    })
  }
}
