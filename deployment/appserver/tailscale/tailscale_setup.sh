#!/bin/sh

AUTH_KEY="${AUTH_KEY:-}"
ROUTES="${ROUTES:-}"
EXTRA_ARGS="${EXTRA_ARGS:-}"

set -e

if [[ ! -d /dev/net ]]; then
mkdir -p /dev/net
fi

if [[ ! -c /dev/net/tun ]]; then
mknod /dev/net/tun c 10 200
fi

echo "Starting tailscaled"
tailscaled --socket=/tmp/tailscaled.sock &
PID=$!

UP_ARGS="--accept-dns=false"
if [[ ! -z "${ROUTES}" ]]; then
  UP_ARGS="--advertise-routes=${ROUTES} ${UP_ARGS}"
fi
if [[ ! -z "${AUTH_KEY}" ]]; then
  UP_ARGS="--authkey=${AUTH_KEY} ${UP_ARGS}"
fi
if [[ ! -z "${EXTRA_ARGS}" ]]; then
  UP_ARGS="${UP_ARGS} ${EXTRA_ARGS:-}"
fi

echo "Running tailscale up"
tailscale --socket=/tmp/tailscaled.sock up ${UP_ARGS}

DB_IP=$(nslookup db | awk '/^Address: / { print $2 }')
echo "DB_IP is ${DB_IP}"
APP_SERVER_IP=$(nslookup app_server | awk '/^Address: / { print $2 }')
echo "APP_SERVER_IP is ${APP_SERVER_IP}"

echo "Adding forwarding rules to iptables"
# db, 5432 -> 5432
iptables -t nat -I PREROUTING -p tcp -d "$(tailscale --socket=/tmp/tailscaled.sock ip -4)" --dport 5432 -j DNAT --to-destination "${DB_IP}"
# app_server, 80 -> 5555
iptables -t nat -I PREROUTING -p tcp -d "$(tailscale --socket=/tmp/tailscaled.sock ip -4)" --dport 80 -j DNAT --to-destination "${APP_SERVER_IP}:5555"
iptables -t nat -I PREROUTING -p udp -d "$(tailscale --socket=/tmp/tailscaled.sock ip -4)" --dport 80 -j DNAT --to-destination "${APP_SERVER_IP}:5555"

wait ${PID}
