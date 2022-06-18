import { ReactElement } from 'react'

export enum MenuItemType {
  Default = 'Default',
  Selectable = 'Selectable',
}

export const ALL_MENU_ITEM_TYPES: ReadonlyArray<MenuItemType> = Object.values(MenuItemType)

/**
 * A Symbol which all `MenuItem` components should set to `MenuItemType` as a static property, so
 * that menu implementations can distinguish between menu items and decorative elements (e.g.
 * dividers, overlines, etc.).
 */
export const MenuItemSymbol = Symbol('MenuItem')

/**
 * Returns true if the specified child has a type marked as a MenuItem (rather than static or
 * decorative content).
 */
export function isMenuItem(child: unknown): child is ReactElement {
  return (
    child &&
    (child as any).type &&
    ALL_MENU_ITEM_TYPES.includes((child as any).type[MenuItemSymbol])
  )
}

/**
 * Returns true if the specified child has a type marked as a selectable MenuItem (rather than any
 * other type of menu item or static or decorative content).
 */
export function isSelectableMenuItem(child: unknown): child is ReactElement {
  return (
    child && (child as any).type && (child as any).type[MenuItemSymbol] === MenuItemType.Selectable
  )
}
