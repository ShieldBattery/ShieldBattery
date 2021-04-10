export interface RallyPointServer {
  id: number
  enabled: boolean
  description: string
  hostname: string
  port: number
}

export interface ResolvedRallyPointServer extends RallyPointServer {
  address4?: string
  address6?: string
}

export interface GetRallyPointServersPayload {
  servers: RallyPointServer[]
}

export interface AddRallyPointServerBody {
  description: string
  hostname: string
  port: number
}

export interface AddRallyPointServerPayload {
  server: RallyPointServer
}

export type UpdateRallyPointServerBody = RallyPointServer

export interface UpdateRallyPointServerPayload {
  server: RallyPointServer
}

export interface UpdateRallyPointClientPingBody {
  ping: number
}
