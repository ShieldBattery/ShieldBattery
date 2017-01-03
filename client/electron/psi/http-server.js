import http from 'http'

export default function(port, host) {
  return http.createServer((req, res) => {
    res.writeHead(418)
    res.end('life of lively 2 live 2 life of full life thx 2 shieldbattery\n')
  }).listen(port, host)
}
