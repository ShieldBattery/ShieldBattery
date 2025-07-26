/**
 * Strips the Virtuoso `context` prop off the incoming props before giving them to the `Component`.
 * Useful when you want to replace a Virtuoso component with a custom one that is just a
 * styled-component and don't want a warning about unknown props every time it renders.
 *
 * Example:
 * ```tsx
 * const MyComponent = eatVirtuosoContext(styled.div`
 *   width: 100%;
 *   height: 100%;
 * `)
 */
export function eatVirtuosoContext(Component: React.ComponentType<any>) {
  return function ContextEater({ context, ...props }: { context?: unknown }) {
    return <Component {...props} />
  }
}
