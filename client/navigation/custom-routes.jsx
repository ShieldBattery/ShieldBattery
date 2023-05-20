import React from 'react'
import { Route } from 'wouter'
import LoginLayout from '../auth/login-layout'

// A custom route for all the components that needs to be wrapped in <LoginLayout>
export const LoginRoute = ({ component: Component, ...rest }) => (
  <Route {...rest}>
    {params => (
      <LoginLayout>
        <Component params={params} />
      </LoginLayout>
    )}
  </Route>
)
