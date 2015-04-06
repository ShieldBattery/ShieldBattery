let React = require('react')
  , Card = require('../material/card.jsx')
  , { Checkbox, TextField, RaisedButton, FlatButton } = require('material-ui')

class Signup extends React.Component {
  constructor() {
    super()
  }

  render() {
    return (
      <Card zDepth={1} className="card-form">
        <form>
          <div className="fields">
            <h3>Sign up</h3>
            <div>
              <TextField floatingLabelText="Username" onEnterKeyDown={e => this.onSignUpClicked()}
                  tabIndex={1}/>
            </div>
            <div>
              <TextField floatingLabelText="Password" onEnterKeyDown={e => this.onSignUpClicked()}
                  tabIndex={1}/>
            </div>
            <div>
              <TextField floatingLabelText="Email address"
                  onEnterKeyDown={e => this.onSignUpClicked()} tabIndex={1}/>
            </div>
          </div>
          <div className="button-area">
            <FlatButton type="button" label="Sign up" secondary={true}
                onTouchTap={e => this.onSignUpClicked(e)} tabIndex={1}/>
          </div>
        </form>
      </Card>
    )
  }

  onSignUpClicked() {
    console.log('clicked!')
  }
}

Signup.contextTypes = {
  router: React.PropTypes.func
}

module.exports = Signup
