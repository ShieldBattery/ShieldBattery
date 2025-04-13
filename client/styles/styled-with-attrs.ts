import styled from 'styled-components'
import { AnyComponent, KnownTarget } from 'styled-components/dist/types'

type ExtractProps<C> = C extends AnyComponent<infer P> ? P : never

/**
 * A replacement for `styled(Foo).attrs({ ... })` that sets the provided attrs as optional in the
 * resulting component.
 *
 * @example
 * const Foo = styledWithAttrs(MyComponent, { size: 16 })``
 */
// TODO(tec27): Delete if https://github.com/styled-components/styled-components/issues/4314 gets
// fixed
export function styledWithAttrs<C extends KnownTarget, A extends Partial<ExtractProps<C>>>(
  component: C,
  attrs: A,
) {
  return styled(component).attrs<Partial<A>>(attrs)
}
