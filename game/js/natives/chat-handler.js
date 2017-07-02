// Handling for chat, allowing for simple registration of commands and for becoming an exclusive
// reader of chat (i.e. receiving events for each line and not having those lines go through any
// registered commands first)
import { EventEmitter } from 'events'
import { Duplex } from 'stream'

class ChatStream extends Duplex {
  constructor(displayFunc, closeCb) {
    super()
    this.displayFunc = displayFunc
    this.closeCb = closeCb || function() {}
    this._closed = false

    this._sendBuffer = ''
    this._timeout = 0
  }

  _setupFinishHandler() {
    this.once('finish', function() {
      if (this._sendBuffer) {
        const lines = this._sendBuffer.split('\n')
        for (const i = 0; i < lines.length; i++) {
          this.displayFunc(lines[i], this._timeout)
        }
        this._sendBuffer = ''
      }
    })
  }

  close() {
    if (this._closed) return
    this.closeCb()
    this.push(null)
  }

  _addLine(line) {
    if (this._closed) return
    this.write(line + '\n')
    this.push(line + '\n')
  }

  _read() {
    // nothing to do, since our source (chat) tells us when stuff is ready and we can't pause it
  }

  _write(chunk, encoding, next) {
    if (this._closed) {
      next(new Error('Stream is already closed'))
      return
    }

    const newBuffer = this._sendBuffer + chunk
    const lines = newBuffer.split('\n')
    for (let i = 0; i < lines.length - 1; i++) {
      this.displayFunc(lines[i], this._timeout)
    }

    this._sendBuffer = lines[lines.length - 1]
    next()
  }

  end(chunk, enc, cb) {
    super.end(chunk, enc, cb)
    this.close()
    this._closed = true
  }

  setMessageTimeout(timeout) {
    this._timeout = timeout
  }
}

class ChatHandler extends EventEmitter {
  constructor(bw) {
    super()
    this.bw = bw
    this._exclusive = null
    this._allyOverride = null
    this._registerWithBindings()
  }

  _registerWithBindings() {
    this.bw.bindings.onCheckForChatCommand = (message, type, recipients) =>
      this._onChatLine(message, type, recipients)
  }

  _onChatLine(message, type, recipients) {
    if (!message) return // BW calls these methods even if no message was typed

    if (this._exclusive) {
      this._exclusive._addLine(message)
      return
    }

    let convertedType
    switch (type) {
      case 2:
        convertedType = 'all'
        break
      case 3:
        convertedType = 'allies'
        break
      case 4:
        convertedType = 'player'
        break
      default:
        convertedType = 'unknown'
    }

    const command = message.split(' ', 1)[0]
    const handled = this.emit(command, message, convertedType, recipients)

    if (!handled) {
      // we didn't handle it, so send it back to BW so it goes through to other users
      if (this._allyOverride !== null && type === 3) {
        this.bw.bindings.sendMultiplayerChatMessage(message, 4, this._allyOverride)
      } else {
        this.bw.bindings.sendMultiplayerChatMessage(message, type, recipients)
      }
    }
  }

  // Allows overriding the send to allies behaviour for setting observer-only chat.
  // Can pass null to disable a previous override.
  overrideAllies(allyStormIds) {
    let bits = 0
    for (const id of allyStormIds) {
      bits |= 1 << id
    }
    this._allyOverride = bits
  }

  grabExclusiveStream() {
    if (this._exclusive) {
      throw new Error('Exclusive lock already obtained')
    }

    this._exclusive = new ChatStream(
      (message, timeout) => this.bw.displayIngameMessage(message, timeout),
      () => {
        this._exclusive = null
      },
    )

    return this._exclusive
  }
}

export default function(bw) {
  return new ChatHandler(bw)
}
