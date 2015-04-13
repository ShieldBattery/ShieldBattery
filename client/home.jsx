import React from 'react'
import Card from './material/card.jsx'
import ActiveUserCount from './serverstatus/active-users.jsx'

class Home extends React.Component {
  render() {
    return (
      <Card zDepth={1}>
        <h3>Welcome home.</h3>
        <p>There'll be some content here eventually</p>
        <p>For now, here's  the user count:</p>
        <ActiveUserCount />
      </Card>
    )
  }
}

export default Home
