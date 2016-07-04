import React, { PropTypes } from 'react'
import ReactDom from 'react-dom'
import styles from './message.css'

import { ChatMessage } from './message.jsx'
import { UserOnlineMessage, UserOfflineMessage } from './message-types.jsx'

export default class MessageList extends React.Component {
  static propTypes = {
    messages: PropTypes.object.isRequired,
    loading: PropTypes.bool,
  };

  constructor(props) {
    super(props)
    this._shouldAutoScroll = true
  }

  shouldComponentUpdate(nextProps) {
    return this.props.messages !== nextProps.messages
  }

  componentWillUpdate() {
    const node = ReactDom.findDOMNode(this)
    this._shouldAutoScroll = (node.scrollTop + node.offsetHeight) >= node.scrollHeight
  }

  componentDidMount() {
    this.maybeScrollToBottom()
  }

  componentDidUpdate() {
    this.maybeScrollToBottom()
  }

  maybeScrollToBottom() {
    if (this._shouldAutoScroll) {
      const node = ReactDom.findDOMNode(this)
      node.scrollTop = node.scrollHeight
    }
  }

  renderMessage(msg) {
    const { id, type } = msg
    switch (type) {
      case 'message':
        return <ChatMessage key={id} user={msg.from} time={msg.time} text={msg.text} />
      case 'userOnline': return <UserOnlineMessage key={id} record={msg} />
      case 'userOffline': return <UserOfflineMessage key={id} record={msg} />
      default: return null
    }
  }

  render() {
    return (<div className={styles.messages}>
      { this.props.loading ? <div>Loading&hellip;</div> : null }
      { this.props.messages.map(msg => this.renderMessage(msg)) }
    </div>)
  }
}
