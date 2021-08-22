// This file should import every `HttpApi` that needs to be included in the app. It doesn't have to
// do anything with them, they just need to be imported so they will be registered with tsyringe
import './lib/chat/chat-api'
import './lib/ladder/ladder-api'
import './lib/logging/logs-api'
import './lib/matchmaking/map-pools-api'
import './lib/matchmaking/matchmaking-api'
import './lib/matchmaking/matchmaking-debug-api'
import './lib/matchmaking/matchmaking-preferences-api'
import './lib/notifications/notification-api'
import './lib/parties/party-api'
import './lib/rally-point/rally-point-api'
import './lib/users/user-api'
import './lib/whispers/whisper-api'
