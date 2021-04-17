import React from 'react'
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

interface InfiniteListProps {
  /** Whether the functionality of loading more data at the beginning of the list is enabled. */
  prevLoadingEnabled?: boolean
  /** Whether the functionality of loading more data at the ending of the list is enabled. */
  nextLoadingEnabled?: boolean
  /** Whether we are currently loading more data at the beginning of the list. */
  isLoadingPrev?: boolean
  /** Whether we are currently loading more data at the ending of the list. */
  isLoadingNext?: boolean
  /** Whether this list has more data that could be loaded at the beginning of the list. */
  hasMorePrevData?: boolean
  /** Whether this list has more data that could be loaded at the ending of the list. */
  hasMoreNextData?: boolean
  /**
   * The element that is used in the `IntersectionObserver` API as the viewport for checking
   * visibility of the target.
   *
   * @default null Means that the browser viewport will be used as origin.
   */
  root?: Element
  /**
   * Margin around the root used in the `IntersectionObserver` API. Can have values similar to the
   * CSS margin property, e.g. "10px 20px 30px 40px" (top, right, bottom, left).
   *
   * @default '0px'
   */
  rootMargin?: string
  /**
   * Either a single number or an array of numbers used in the `IntersectionObserver` API which
   * indicate at what percentage of the target's visibility the observer's callback should be
   * executed.
   *
   * @default 0 Means as soon as one pixel is visible, the callback will be run.
   */
  threshold?: number | Array<number>
  /** Callback whenever the list wants to load more data at the beginning of the list. */
  onLoadMorePrevData?: () => void
  /** Callback whenever the list wants to load more data at the ending of the list. */
  onLoadMoreNextData?: () => void
}

/**
 * A component that implements the functionality of an infinite scrolling lists, by wrapping the
 * `IntersectionObserver` API, which provides a way to asynchronously observe changes in the
 * intersection of a target element with an ancestor element. Supports loading data dynamically both
 * at the beginning and the ending of the list.
 * NOTE(2Pac): This component currently has two limitations that need to be mindful of:
 *   1) The initial amount of loaded items need to have enough height to cause the scrollbar to
 *      show, otherwise it won't be possible to trigger the intersection callback a second time.
 *   2) If the newly loaded items don't increase the height of the list (by putting items in the
 *      same row for example), it won't be possible to load more items from that point on.
 */
export default class InfiniteList extends React.Component<InfiniteListProps> {
  private observer: IntersectionObserver | undefined
  private prevTargetRef = React.createRef<HTMLDivElement>()
  private nextTargetRef = React.createRef<HTMLDivElement>()

  private startObserving() {
    if (!this.observer) return

    const prevTarget = this.prevTargetRef.current
    if (this.props.prevLoadingEnabled && prevTarget) {
      this.observer.observe(prevTarget)
    }

    const nextTarget = this.nextTargetRef.current
    if (this.props.nextLoadingEnabled && nextTarget) {
      this.observer.observe(nextTarget)
    }
  }

  componentDidMount() {
    const { root, rootMargin, threshold } = this.props

    this.observer = new IntersectionObserver(this.onIntersection, {
      root,
      rootMargin,
      threshold,
    })

    this.startObserving()
  }

  componentWillUnmount() {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = undefined
    }
  }

  /**
   * This function allows the use case of using the same instance of the infinite scroll list
   * multiple times inside another component; eg. common when using it with tabs.
   */
  reset() {
    if (this.observer) {
      this.observer.disconnect()
      this.startObserving()
    }
  }

  render() {
    const {
      prevLoadingEnabled,
      nextLoadingEnabled,
      isLoadingPrev,
      isLoadingNext,
      hasMorePrevData,
      hasMoreNextData,
    } = this.props

    return (
      <>
        {prevLoadingEnabled && hasMorePrevData ? (
          <LoadingArea ref={this.prevTargetRef}>
            {isLoadingPrev ? <LoadingIndicator /> : null}
          </LoadingArea>
        ) : null}

        {this.props.children}

        {nextLoadingEnabled && hasMoreNextData ? (
          <LoadingArea ref={this.nextTargetRef}>
            {isLoadingNext ? <LoadingIndicator /> : null}
          </LoadingArea>
        ) : null}
      </>
    )
  }

  onIntersection = (entries: IntersectionObserverEntry[]) => {
    const {
      prevLoadingEnabled,
      nextLoadingEnabled,
      isLoadingPrev,
      isLoadingNext,
      hasMorePrevData,
      hasMoreNextData,
      onLoadMorePrevData,
      onLoadMoreNextData,
    } = this.props

    entries.forEach(entry => {
      if (!entry.isIntersecting) {
        return
      }

      if (prevLoadingEnabled && entry.target === this.prevTargetRef.current) {
        if (!isLoadingPrev && hasMorePrevData && onLoadMorePrevData) {
          onLoadMorePrevData()
        }
      }
      if (nextLoadingEnabled && entry.target === this.nextTargetRef.current) {
        if (!isLoadingNext && hasMoreNextData && onLoadMoreNextData) {
          onLoadMoreNextData()
        }
      }
    })
  }
}
