import { ReactElement } from 'react'

/**
 * A Symbol which all `MenuItem` components should set to true as a static property, so that
 * menu implementations can distinguish between menu items and decorative elements (e.g. dividers,
 * overlines, etc.).
 */
export const MenuItemSymbol = Symbol('MenuItem')

/**
 * Returns true of the specified child has a typed marked as a MenuItem (rather than static or
 * decorative content).
 */
export function isMenuItem(child: unknown): child is ReactElement {
  return child && (child as any).type && (child as any).type[MenuItemSymbol]
}
