#!/usr/bin/env bash
# A small script that executes a bash command _after_
# a bunch of remote TCP ports have become available.
#
# This is generally to help make sure that other
# services e.g. database, cache, have started
# before starting the main process.
#
# To specify an endpoint, call this script with:
# --endpoint <hostname>:<TCP port number>:<ttl in seconds>
# I.e.
# --endpoint db:3306:10
#
# You can repeat the --endpoint flag as many times as you like.
#
# Part of the logic in this script within the 'wait_for_endpoint' function
# block, is taken from it's predecessor `wait-for-it.sh`
# which is `Copyright (c) 2016 Giles Hall` and
# is also available (at the time of writing this) at the following link:
# https://github.com/vishnubob/wait-for-it.

############################# FUNCS #############################
function wait_for_endpoint
{
    WAIT_HOST="$1"
    WAIT_PORT="$2"
    WAIT_TIMEOUT="$3"

    TIMEOUT_PATH="$(type -p timeout)"
    TIMEOUT_PATH="$(realpath "${TIMEOUT_PATH}" 2>/dev/null || readlink -f "${TIMEOUT_PATH}")"

    echo "Waiting for ${WAIT_HOST}:${WAIT_PORT}"

    declare -i NUM_SECS=0

    while :
    do
        if [[ $TIMEOUT_PATH =~ "busybox" ]]; then
            nc -z "${WAIT_HOST}" "${WAIT_PORT}"
            RES=$?
        else
            (echo -n > "/dev/tcp/${WAIT_HOST}/${WAIT_PORT}") >/dev/null 2>&1
            RES=$?
        fi

        if [[ $RES -eq 0 ]]; then
            echo "${WAIT_HOST}:${WAIT_PORT} is now available."
            break
        fi

        sleep 1
        NUM_SECS=$(($NUM_SECS+1))

        if [ $NUM_SECS -ge ${WAIT_TIMEOUT} ]; then
            echo "${WAIT_HOST}:${WAIT_PORT} isn't available after ${WAIT_TIMEOUT} seconds."
            RES=1
            break
        fi
    done

    return $RES
}
########################### END FUNCS ###########################

declare -a WAIT_ENDPOINTS=()
WAIT_CMD=()

while [[ $# -gt 0 ]]
do
    case "$1" in
      "--endpoint")
        readarray -d ":" -t endpoint <<< $2

        # If there's no timeout length, use the default 15s
        if [ "${endpoint[2]}" == "" ]; then
            endpoint[2]=15
        else
            endpoint[2]="$(echo "${endpoint[2]}" | sed 's/[^0-9]//g')"
        fi

        WAIT_ENDPOINTS+=("${endpoint[*]}")

        shift 2
      ;;
      *)
          WAIT_CMD+=("$1")
          shift 1
      ;;
    esac
done

if [ ${#WAIT_ENDPOINTS[@]} -eq 0 ]; then
    echo "No endpoints were specified. Please try again using: '--endpoint <hostname>:<TCP port number>:<ttl in seconds>'."
    exit 1
fi

COUNT=${#WAIT_ENDPOINTS[@]}
for ((i=0; i<$COUNT; i++))
do
    BITS=(${WAIT_ENDPOINTS[$i]})
    HOST=(${BITS[@]:0})
    PORT=(${BITS[@]:1})
    TO=(${BITS[@]:2})

    wait_for_endpoint ${HOST} ${PORT} ${TO}
    RES=$?

    if [[ ${RES} -gt 0 ]]; then
        echo "Unable to run command, some services have refused to start."
        exit $RES
    fi
done

exec ${WAIT_CMD[@]}
