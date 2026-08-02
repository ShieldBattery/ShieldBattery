// Allows importing an .html file's contents as a string. The `?raw` suffix is what makes the
// bundler inline the file rather than treating it as a page to process; without it the import
// resolves to an empty module.
declare module '*.html?raw' {
  const src: string
  export default src
}
