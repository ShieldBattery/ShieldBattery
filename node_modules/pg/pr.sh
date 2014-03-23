#!/bin/bash

branch_name=$(git symbolic-ref -q HEAD)
branch_name=${branch_name##refs/heads/}
branch_name=${branch_name:-HEAD}

issue=${branch_name##*/}

curl --user "brianc" \
     --request POST \
     --data "{\"issue\": \"$issue\", \"head\": \"brianc:$branch_name\", \"base\": \"master\"}" \
     https://api.github.com/repos/brianc/node-postgres/pulls
