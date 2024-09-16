// Taken from:
//    https://github.com/styled-components/styled-components/issues/4076#issuecomment-1999809785
// Hopefully this won't be necessary one day :(
import { ComponentProps, JSXElementConstructor } from 'react'
import { styled, StyledInstance } from 'styled-components'
import type {
  AnyComponent,
  Attrs,
  BaseObject,
  FastOmit,
  KnownTarget,
  Runtime,
  StyledTarget,
} from 'styled-components/dist/types.js'

type MakeOverlappingPropsOptional<
  GBase extends BaseObject,
  GOther extends Partial<GBase>,
> = FastOmit<GBase, keyof GOther> & Partial<GOther>

/**
 * Style a component with the given attributes. This is the same as `styled(Foo).attrs(...)` but
 * marks any provided attributes as optional on the resulting component.
 *
 * **Example:**
 * ```
 * const ColoredWarningIcon = styledWithAttrs(MaterialIcon)({ icon: 'warning', size: 36 })
 * ```
 */
export function styledWithAttrs<
  GRuntime extends Runtime,
  /**
   * Provides no benefit to use string (web-components)
   */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  GTarget extends Extract<StyledTarget<GRuntime>, AnyComponent | KnownTarget>,
>(target: GTarget) {
  type TBase = ComponentProps<GTarget>
  const styledTarget = styled(target)

  /**
   * @returns the regular styled() call, but overriding the props
   */
  function withAttrs<GOther extends Partial<TBase>>(attrs: Attrs<GOther>) {
    type TOverlapped = MakeOverlappingPropsOptional<TBase, GOther>
    return (
      styledTarget as StyledInstance<GRuntime, JSXElementConstructor<TOverlapped>, TOverlapped>
    ).attrs(attrs as TOverlapped)
  }

  return withAttrs
}
