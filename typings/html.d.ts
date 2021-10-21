// Allows us to import * as Foo from 'foo.svg' in webpack'd files
declare module '*.html' {
  const src: string
  export default src
}
