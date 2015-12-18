import React from 'react'
import Card from './material/card.jsx'
import ActiveUserCount from './serverstatus/active-users.jsx'
import RaisedButton from './material/raised-button.jsx'
import auther from './auth/auther'

class Home extends React.Component {
  static contextTypes = {
    store: React.PropTypes.object.isRequired,
  }

  render() {
    return (
      <Card zDepth={1}>
        <h3>Welcome home.</h3>
        <p>There'll be some content here eventually</p>
        <p>For now, here's  the user count:</p>
        <ActiveUserCount />
        <RaisedButton label='Log out (TODO(tec27))' onClick={::this.onLogOutClicked} />
      </Card>
    )
  }

  onLogOutClicked() {
    this.context.store.dispatch(auther.logOut().action)
  }
}

export default Home
