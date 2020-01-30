import React from 'react'
import { Link, Route, Switch } from 'react-router-dom'

import DevButtons from './buttons-test.jsx'
import DevMenu from './menu-test.jsx'
import DevPopover from './popover-test.jsx'
import DevSelects from './selects-test.jsx'
import DevSliders from './slider-test.jsx'
import DevTextFields from './text-field-test.jsx'

class DevMaterialDashboard extends React.Component {
  render() {
    const { baseUrl } = this.props

    return (
      <ul>
        <li>
          <Link to={baseUrl + '/button'}>Button component</Link>
        </li>
        <li>
          <Link to={baseUrl + '/menu'}>Menu component</Link>
        </li>
        <li>
          <Link to={baseUrl + '/popover'}>Popover component</Link>
        </li>
        <li>
          <Link to={baseUrl + '/select'}>Select component</Link>
        </li>
        <li>
          <Link to={baseUrl + '/slider'}>Slider component</Link>
        </li>
        <li>
          <Link to={baseUrl + '/textfield'}>Textfield component</Link>
        </li>
      </ul>
    )
  }
}

export default props => {
  const baseUrl = props.match.url
  return (
    <Switch>
      <Route
        path={baseUrl}
        exact={true}
        render={() => <DevMaterialDashboard baseUrl={baseUrl} />}
      />
      <Route path={baseUrl + '/button'} component={DevButtons} />
      <Route path={baseUrl + '/menu'} component={DevMenu} />
      <Route path={baseUrl + '/popover'} component={DevPopover} />
      <Route path={baseUrl + '/select'} component={DevSelects} />
      <Route path={baseUrl + '/slider'} component={DevSliders} />
      <Route path={baseUrl + '/textfield'} component={DevTextFields} />
    </Switch>
  )
}
