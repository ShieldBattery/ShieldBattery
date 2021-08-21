import React, { useCallback, useEffect, useRef } from 'react'
import styled from 'styled-components'
import LoadingIndicator from '../progress/dots'
import { useValueAsRef } from '../state-hooks'

const LoadingArea = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  min-height: 56px;
  padding: 16px 0;
`

interface InfiniteListProps {
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
export default function InfiniteList(props: InfiniteListProps) {
  const { root, rootMargin, threshold, refreshToken } = props
  const prevLoadingEnabledRef = useValueAsRef(props.prevLoadingEnabled)
  const nextLoadingEnabledRef = useValueAsRef(props.nextLoadingEnabled)
  const isLoadingPrevRef = useValueAsRef(props.isLoadingPrev)
  const isLoadingNextRef = useValueAsRef(props.isLoadingNext)
  const hasPrevDataRef = useValueAsRef(props.hasPrevData)
  const hasNextDataRef = useValueAsRef(props.hasNextData)
  const onLoadPrevDataRef = useValueAsRef(props.onLoadPrevData)
  const onLoadNextDataRef = useValueAsRef(props.onLoadNextData)
  const prevTargetRef = useRef<HTMLDivElement>(null)
  const nextTargetRef = useRef<HTMLDivElement>(null)
  const observer = useRef<IntersectionObserver>()

  const startObserving = useCallback(() => {
    if (!observer.current) {
      return
    }

    const prevTarget = prevTargetRef.current
    if (prevLoadingEnabledRef.current && prevTarget) {
      observer.current.observe(prevTarget)
    }

    const nextTarget = nextTargetRef.current
    if (nextLoadingEnabledRef.current && nextTarget) {
      observer.current.observe(nextTarget)
    }
  }, [nextLoadingEnabledRef, prevLoadingEnabledRef])

  const onIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          return
        }

        if (prevLoadingEnabledRef.current && entry.target === prevTargetRef.current) {
          if (!isLoadingPrevRef.current && hasPrevDataRef.current && onLoadPrevDataRef.current) {
            onLoadPrevDataRef.current()
          }
        }
        if (nextLoadingEnabledRef.current && entry.target === nextTargetRef.current) {
          if (!isLoadingNextRef.current && hasNextDataRef.current && onLoadNextDataRef.current) {
            onLoadNextDataRef.current()
          }
        }
      }
    },
    [
      hasNextDataRef,
      hasPrevDataRef,
      isLoadingNextRef,
      isLoadingPrevRef,
      nextLoadingEnabledRef,
      onLoadNextDataRef,
      onLoadPrevDataRef,
      prevLoadingEnabledRef,
    ],
  )

  useEffect(() => {
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
  }, [root, rootMargin, threshold, onIntersection, startObserving])

  useEffect(() => {
    observer.current?.disconnect()
    startObserving()
  }, [refreshToken, startObserving])

  return (
    <>
      {prevLoadingEnabledRef.current && hasPrevDataRef.current ? (
        <LoadingArea ref={prevTargetRef}>
          {isLoadingPrevRef.current ? <LoadingIndicator /> : null}
        </LoadingArea>
      ) : null}

      {props.children}

      {nextLoadingEnabledRef.current && hasNextDataRef.current ? (
        <LoadingArea ref={nextTargetRef}>
          {isLoadingNextRef.current ? <LoadingIndicator /> : null}
        </LoadingArea>
      ) : null}
    </>
  )
}
