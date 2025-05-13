---
applyTo: '**/client/**/*.ts*'
---

- Use react-i18next to translate any text that will be shown to users. Prefer
  re-using existing translation strings from `server/public/locales/en/global.json` if they are
  relevant.
- Always use `useAppDispatch` and `useAppSelector` rather than `useDispatch` and `useSelector` when
  using Redux
- Use styled-components for styling. Prefer to group CSS rules by layout
  (position/bounds/margin/padding), then display type (e.g. flexbox and associated properties for
  children), then appearance, then miscellaneous properties.
- Prefer functional components of the form `function MyComponent({ prop1, prop2 }: Props) { ... }`
  over `const MyComponent = ({ prop1, prop2 }: Props) => { ... }`. Prefer functions over class
  components.
