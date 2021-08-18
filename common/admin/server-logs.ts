export interface LogEntryData {
  level: number
  time: number
  pid: number
  hostname: string
  msg: string

  req?: {
    id: string
    url: string
    method: string
    headers: Record<string, string>
  }

  res?: {
    statusCode: number
  }

  responseTime?: number

  err?: {
    type: string
    stack?: string
    message?: string
  }
}

export interface LogEntry {
  id: string
  time: Date
  data: LogEntryData
}

export interface GetLogsPayload {
  entries: LogEntry[]
}
