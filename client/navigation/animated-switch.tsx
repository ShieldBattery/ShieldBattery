import { AnimatePresence } from 'motion/react'
import React, { cloneElement, Fragment, isValidElement } from 'react'
import { Match, matchRoute, RouteProps, useLocation, useRouter } from 'wouter'

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

// A modified version of wouter's Switch that lets us render an animated container
export function AnimatedSwitch({
  children,
  container,
}: {
  children: React.ReactNode
  container: React.ReactElement<{ children: React.ReactNode }>
}) {
  const router = useRouter()
  const [location] = useLocation()

  for (const _element of flattenChildren(children)) {
    if (!isValidElement(_element)) continue
    const element = _element as React.ReactElement<RouteProps & { match?: Match<any> }>
    const match = matchRoute(router.parser, element.props.path!, location, element.props.nest)

    if (match[0]) {
      const contents = cloneElement(element, { match })
      return (
        <AnimatePresence key='--presence--' initial={false}>
          {cloneElement(container, { key: String(element.props.path ?? ''), children: contents })}
        </AnimatePresence>
      )
    }
  }

  return null
}
