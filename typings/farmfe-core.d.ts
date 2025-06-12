// Dependency of unplugin-swc whose typings seem to have issues, but we never use it ourselves
// anyway
declare module '@farmfe/core' {
  export type CompilationContext = any
  export type JsPlugin = any
}
