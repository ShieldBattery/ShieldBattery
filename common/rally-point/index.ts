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

export interface GetRallyPointServersResponse {
  servers: RallyPointServer[]
}

export interface AddRallyPointServerRequest {
  description: string
  hostname: string
  port: number
}

export interface AddRallyPointServerResponse {
  server: RallyPointServer
}

export type UpdateRallyPointServerRequest = RallyPointServer

export interface UpdateRallyPointServerResponse {
  server: RallyPointServer
}

export interface UpdateRallyPointClientPingRequest {
  ping: number
}
