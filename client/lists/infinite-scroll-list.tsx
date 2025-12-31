import * as React from 'react'
import { useEffect, useRef } from 'react'
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

export interface InfiniteListProps {
  children: React.ReactNode
  /** Whether the functionality of loading data at the beginning of the list is enabled. */
  prevLoadingEnabled?: boolean
  /** Whether the functionality of loading data at the ending of the list is enabled. */
  nextLoadingEnabled?: boolean
  /** Whether we are currently loading data at the beginning of the list. */
  isLoadingPrev?: boolean
  /** Whether we are currently loading data at the ending of the list. */
  isLoadingNext?: boolean
  /** Whether this list has data that could be loaded at the beginning of the list. */
  hasPrevData?: boolean
  /** Whether this list has data that could be loaded at the ending of the list. */
  hasNextData?: boolean
  /**
   * A value which will restart the intersection observer when it changes, i.e. disconnect and start
   * observing again, when it changes. This is useful when the same instance of this component is
   * used for lists with different content, e.g. in tabs, chat channels, and whisper sessions.
   */
  refreshToken?: unknown
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
  /** Callback whenever the list wants to load data at the beginning of the list. */
  onLoadPrevData?: () => void
  /** Callback whenever the list wants to load data at the ending of the list. */
  onLoadNextData?: () => void
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
export default function InfiniteList({
  children,
  prevLoadingEnabled,
  nextLoadingEnabled,
  isLoadingPrev,
  isLoadingNext,
  hasPrevData,
  hasNextData,
  refreshToken,
  root,
  rootMargin,
  threshold,
  onLoadPrevData,
  onLoadNextData,
}: InfiniteListProps) {
  const prevTargetRef = useRef<HTMLDivElement>(null)
  const nextTargetRef = useRef<HTMLDivElement>(null)
  const observer = useRef<IntersectionObserver>(undefined)

  // NOTE(2Pac): We restart the observer in a couple of cases:
  //   - `hasPrevData`/`hasNextData` has changed; this allows InfiniteScrollList to be rendered
  //     without more data being available initially, and then it starts observing if that changes.
  //   - `refreshToken` has changed; this means the user of this component forcefully wants to
  //     restart observing for whatever reason.
  useEffect(() => {
    const startObserving = () => {
      if (!observer.current) {
        return
      }

      const prevTarget = prevTargetRef.current
      if (prevLoadingEnabled && prevTarget) {
        observer.current.observe(prevTarget)
      }

      const nextTarget = nextTargetRef.current
      if (nextLoadingEnabled && nextTarget) {
        observer.current.observe(nextTarget)
      }
    }

    const onIntersection = (entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue
        }

        if (prevLoadingEnabled && entry.target === prevTargetRef.current) {
          if (!isLoadingPrev && hasPrevData && onLoadPrevData) {
            onLoadPrevData()
          }
        }
        if (nextLoadingEnabled && entry.target === nextTargetRef.current) {
          if (!isLoadingNext && hasNextData && onLoadNextData) {
            onLoadNextData()
          }
        }
      }
    }

    observer.current = new IntersectionObserver(onIntersection, {
      root,
      rootMargin,
      threshold,
    })

    startObserving()

    return () => {
      observer.current?.disconnect()
      observer.current = undefined
    }
  }, [
    root,
    rootMargin,
    threshold,
    prevLoadingEnabled,
    nextLoadingEnabled,
    isLoadingPrev,
    hasPrevData,
    onLoadPrevData,
    isLoadingNext,
    hasNextData,
    onLoadNextData,
    refreshToken,
  ])

  return (
    <>
      {prevLoadingEnabled && hasPrevData ? (
        <LoadingArea ref={prevTargetRef}>{isLoadingPrev ? <LoadingIndicator /> : null}</LoadingArea>
      ) : null}

      {children}

      {nextLoadingEnabled && hasNextData ? (
        <LoadingArea ref={nextTargetRef}>{isLoadingNext ? <LoadingIndicator /> : null}</LoadingArea>
      ) : null}
    </>
  )
}
