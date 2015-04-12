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
                  tabIndex={1} ref="username"/>
            </div>
            <div>
              <TextField floatingLabelText="Password" onEnterKeyDown={e => this.onSignUpClicked()}
                  tabIndex={1} type="password" ref="password"/>
            </div>
            <div>
              <TextField floatingLabelText="Confirm password"
                  onEnterKeyDown={e => this.onSignUpClicked()} tabIndex={1} type="password"
                  ref="confirmPassword"/>
            </div>
            <div>
              <TextField floatingLabelText="Email address"
                  onEnterKeyDown={e => this.onSignUpClicked()} tabIndex={1} ref="email"/>
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
    let username = this.refs.username.getValue()
      , password = this.refs.password.getValue()
      , confirmPasword = this.refs.confirmPassword.getValue()
      , email = this.refs.email.getValue()
    console.log('clicked!')
  }
}

Signup.contextTypes = {
  router: React.PropTypes.func
}

module.exports = Signup
