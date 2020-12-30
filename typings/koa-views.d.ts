// NOTE(tec27): This fixes the rather bad built-in typings of koa-views that break a ton of things,
// sigh.

declare module 'koa-views' {
  import * as Koa from 'koa'

  export type ViewsOptions = {
    /**
     * Whether to use ctx.body to receive the rendered template string. Defaults to true.
     */
    autoRender?: boolean
    /**
     * Default extension for your views
     */
    extension?: string
    /**
     * Map a file extension to an engine
     */
    map?: any
    /**
     * replace consolidate as default engine source
     */
    engineSource?: any
    /**
     * These options will get passed to the view engine. This is the time to add partials and
     * helpers etc.
     */
    options?: any
  }

  export default function views(root: string, opts?: ViewsOptions): Koa.Middleware
}
