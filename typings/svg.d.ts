// Allows us to import * as Foo from 'foo.svg' in webpack'd files
declare module '*.svg' {
  import * as React from 'react'

  const component: React.ComponentType<any>
  export default component
}
