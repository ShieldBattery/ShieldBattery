let React = require('react')
  , { SvgIcon } = require('material-ui');

class MoreVert extends React.Component {
  render() {
    return (
      <SvgIcon {...this.props}>
        <path d={"M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 " +
            "2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"}/>
      </SvgIcon>
    )
  }
}

module.exports = MoreVert;
