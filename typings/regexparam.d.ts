// NOTE(tec27): Fix for https://github.com/lukeed/regexparam/issues/31, if that gets fixed this can
// be removed
declare module 'regexparam' {
  import { EmptyObject } from 'type-fest'

  export function parse(
    route: string,
    loose?: boolean,
  ): {
    keys: string[]
    pattern: RegExp
  }

  export function parse(route: RegExp): {
    keys: false
    pattern: RegExp
  }

  export type RouteParams<T extends string> = T extends `${infer Prev}/*/${infer Rest}`
    ? RouteParams<Prev> & { wild: string } & RouteParams<Rest>
    : T extends `${string}:${infer P}/${infer Rest}`
      ? P extends `${infer S}?`
        ? { [K in S]?: string } & RouteParams<Rest>
        : { [K in P]: string } & RouteParams<Rest>
      : T extends `${string}:${infer P}?`
        ? { [K in P]?: string }
        : T extends `${string}:${infer P}`
          ? { [K in P]: string }
          : T extends `${string}*`
            ? { '*': string }
            : T extends `${string}*?`
              ? { '*'?: string }
              : EmptyObject

  export function inject<T extends string>(route: T, values: RouteParams<T>): string
}
