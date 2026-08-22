import * as React from 'react'
import { cloneElement, Fragment, isValidElement, Suspense, useRef } from 'react'
import { Match, matchRoute, RouteProps, useLocation, useRouter } from 'wouter'
import { useMultiplexRef } from '../react/refs'
import { useScrollResetOnNavigate } from './router-hooks'

function flattenChildren(children: React.ReactNode): Iterable<React.ReactNode> {
  return Array.isArray(children)
    ? children.flatMap(c =>
        flattenChildren(
          c && (c as React.ReactElement).type === Fragment
            ? (c as React.ReactElement<any>).props.children
            : c,
        ),
      )
    : [children]
}

/** A modified version of wouter's Switch that lets us render an animated container. */
export function AnimatedSwitch({
  children,
  container,
  fallback,
}: {
  children: React.ReactNode
  container: React.ReactElement<{ children?: React.ReactNode; ref?: React.Ref<HTMLElement> }>
  fallback: React.ReactNode
}) {
  const router = useRouter()
  const [location] = useLocation()

  const containerRef = useRef<HTMLElement>(null)
  useScrollResetOnNavigate(containerRef)
  const containerMultiRef = useMultiplexRef(containerRef, container.props.ref)

  for (const _element of flattenChildren(children)) {
    if (!isValidElement(_element)) continue
    const element = _element as React.ReactElement<RouteProps & { match?: Match<any> }>
    const match = matchRoute(router.parser, element.props.path!, location, element.props.nest)

    if (match[0]) {
      const contents = cloneElement(element, { match })
      const children = <Suspense fallback={fallback}>{contents}</Suspense>
      // The container is keyed by route pattern so its subtree (and enter animation) persists
      // across navigations within the same pattern; the scroll reset keeps such a reused
      // container from carrying one location's scroll position over to another.
      return cloneElement(container, {
        key: String(element.props.path ?? ''),
        ref: containerMultiRef,
        children,
      })
    }
  }

  return null
}
