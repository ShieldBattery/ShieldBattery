// A Symbol which all `MenuItem` components should set to true as their static property, so that
// menu implementations can distinguish between menu items and decorative elements (e.g. dividers,
// overlines, etc.).
const MenuItemSymbol = Symbol('MenuItem')

export default MenuItemSymbol
