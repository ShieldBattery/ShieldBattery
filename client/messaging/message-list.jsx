import React, { PropTypes } from 'react'
import styles from './message.css'

import { ChatMessage } from './message.jsx'
import { UserOnlineMessage, UserOfflineMessage } from './message-types.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'

export default class MessageList extends React.Component {
  static propTypes = {
    messages: PropTypes.object.isRequired,
    loading: PropTypes.bool,
    onScrollUpdate: PropTypes.func,
  };

  shouldComponentUpdate(nextProps) {
    return this.props.messages !== nextProps.messages
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
    return (<ScrollableContent
        autoScroll={true}
        onUpdate={this.props.onScrollUpdate}
        className={styles.messagesScrollable}
        viewClassName={styles.messagesScrollableView}>
      <div className={styles.messages}>
        { this.props.loading ? <div>Loading&hellip;</div> : null }
        { this.props.messages.map(msg => this.renderMessage(msg)) }
      </div>
    </ScrollableContent>)
  }
}
