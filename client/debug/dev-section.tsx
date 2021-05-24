import React, { ComponentType } from 'react'
import { DefaultParams, Link, Route, RouteComponentProps, Switch } from 'wouter'

/** Renders a list of links to dev-only components. */
export function DevSection(props: {
  baseUrl: string
  routes: Array<
    [label: string, path: string, component: ComponentType<RouteComponentProps<DefaultParams>>]
  >
}) {
  return (
    <Switch>
      <>
        {props.routes.map(([label, path, component]) => (
          <Route path={`${props.baseUrl}/${path}/:rest*`} component={component} key={path} />
        ))}
      </>
      <Route key={'/'}>
        <ul>
          {props.routes.map(([label, path, component]) => (
            <li key={path}>
              <Link href={`${props.baseUrl}/${path}`}>{label}</Link>
            </li>
          ))}
        </ul>
      </Route>
    </Switch>
  )
}
