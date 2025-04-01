import { Runtime, StyledInstance } from 'styled-components'
import { StyledTarget } from 'styled-components/dist/types'

type ExtractProps<C> = C extends StyledInstance<any, any, infer P, any> ? P : never

/**
 * A replacement for `styled(Foo).attrs({ ... })` that sets the provided attrs as optional in the
 * resulting component.
 *
 * @example
 * const Foo = withAttrs(styled(MyComponent), { size: 16 })``
 */
// TODO(tec27): Delete if https://github.com/styled-components/styled-components/issues/4314 gets
// fixed
export function withAttrs<
  C extends StyledInstance<R, T, OP, OS>,
  A extends Partial<ExtractProps<C>>,
  R extends Runtime,
  T extends StyledTarget<R>,
  OP extends object,
  OS extends object,
>(component: C, attrs: A) {
  return component.attrs<Partial<A>>(attrs)
}
