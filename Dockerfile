# Get sqlx-cli so we can run migrations (Linux version needs to match what we run on below)
FROM ghcr.io/shieldbattery/shieldbattery/base:sqlx-tools AS rust-tools

# Clone external tools in a separate stage for better caching
FROM node:22-alpine AS external-tools
RUN apk add --no-cache git
# Clone the `wait-for-it` repository which contains a script we'll copy over to our final image, and
# use it to control our services startup order
RUN git clone --depth 1 https://github.com/vishnubob/wait-for-it.git
# Clone the `s3cmd` repository which contains a script we'll copy over to our final image, and use
# it to sync our public assets to the cloud
RUN git clone --depth 1 https://github.com/s3tools/s3cmd.git

# Install dependencies in a separate stage for better caching
FROM node:22-alpine AS deps
RUN corepack enable
# By default, `alpine` images don't have necessary tools to install native add-ons, so we use the
# multistage build to install the necessary tools, and build the dependencies which will then be
# copied over to the next stage (this stage will be discarded, along with the installed tools, to
# make the image lighter).
RUN apk add --no-cache python3 make g++ git cmake

WORKDIR /shieldbattery
# Ensure that we don't spend time installing dependencies that are only needed for the client
# application.
ENV SB_SERVER_ONLY=1

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Build the server scripts (Linux version needs to match what we run on below)
FROM deps AS builder
# Copy the whole repository to the image, *except* the stuff marked in the `.dockerignore` file
COPY . .

# Prebuild the web client assets so we can simply copy them over
ENV NODE_ENV=production
RUN pnpm run build-web-client

# Then prune the server deps to only the production ones
RUN pnpm prune --prod


# Setup the actual image
FROM node:22-alpine

# Run pnpm once so we ensure it gets installed by corepack during the container build
RUN corepack enable && pnpm --version

ENV NODE_ENV=production
# Tell the server not to try and run webpack
ENV SB_PREBUILT_ASSETS=true

# Since we're executing some bash scripts (eg. `wait-for-it.sh`) before running the containers using
# this image, we need to install it explicitly because alpine-based images don't have it by default.
# Also, we need python to execute some python scripts (e.g. `s3cmd`).
RUN apk add --no-cache bash logrotate jq python3 py-pip

# Install the dependencies of the `s3cmd` python script (--break-system-packages because otherwise
# we'd need a virtualenv, which is overkill since we're not using python for anything else)
RUN pip3 install python-dateutil --break-system-packages

# Set up log rotation
COPY --from=builder /shieldbattery/server/deployment_files/logrotate.conf /etc/logrotate.d/shieldbattery

# Give the logrotate status file to the node user since that's what crond will be running under
RUN touch /var/lib/logrotate.status && chown node:node /var/lib/logrotate.status

# Set the user to `node` for any subsequent `RUN` and `CMD` instructions
USER node

# Set the working directory to the home directory of the `node` user
WORKDIR /home/node/shieldbattery

# Copy sqlx binary for migrations
COPY --chown=node:node --from=rust-tools /bin/sqlx tools/sqlx

# Copy the installed dependencies from the external-tools stage
COPY --chown=node:node --from=external-tools /wait-for-it/wait-for-it.sh tools/wait-for-it.sh
COPY --chown=node:node --from=external-tools /s3cmd/s3cmd tools/s3cmd/s3cmd
COPY --chown=node:node --from=external-tools /s3cmd/S3 tools/s3cmd/S3

# Copy just the sources the server needs
COPY --chown=node:node --from=builder /shieldbattery/node_modules ./node_modules
COPY --chown=node:node --from=builder /shieldbattery/common ./common
COPY --chown=node:node --from=builder /shieldbattery/server ./server
COPY --chown=node:node --from=builder /shieldbattery/migrations ./migrations
COPY --chown=node:node --from=builder /shieldbattery/package.json /shieldbattery/babel.config.json ./
COPY --chown=node:node --from=builder /shieldbattery/babel-register.js /shieldbattery/babel-register.js ./
COPY --chown=node:node --from=builder /shieldbattery/server/deployment_files/entrypoint.sh /entrypoint.sh

# Allow the various scripts to be run
RUN chmod +x ./server/update_server.sh ./server/testing/run_mailgun.sh ./server/testing/run_google_cloud.sh /entrypoint.sh

# Make the various volume locations as the right user (if we let Docker do it they end up owned by
# root and not writeable)
RUN mkdir ./server/logs && mkdir ./server/uploaded_files && mkdir ./server/bw_sprite_data

RUN touch /var/lib/logrotate.status

# http (generally reverse-proxied to)
EXPOSE 5555/tcp

CMD ["/entrypoint.sh"]
