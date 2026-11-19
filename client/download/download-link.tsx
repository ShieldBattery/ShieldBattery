import { makeServerUrl } from '../network/server-url'

/** A link to the download page of the server this client is connected to. */
export function DownloadLink({ children }: { children?: React.ReactNode }) {
  return (
    <a href={makeServerUrl('/download')} target='_blank' rel='noopener noreferrer'>
      {children}
    </a>
  )
}
