# ---------- 1st stage ----------
# The first stage adds the necessary libraries to build native add-ons (eg. bcrypt) and then installs
# the server dependencies
FROM node:16-alpine as builder

# By default, `alpine` images don't have necessary tools to install native add-ons, so we use the
# multistage build to install the necessary tools, and build the dependencies which will then be
# copied over to the next stage (this stage will be discarded, along with the installed tools, to
# make the image lighter).
RUN apk add --no-cache python3 make g++ git

# Ensure that we don't spend time installing dependencies that are only needed for the client
# application.
ENV SB_SERVER_ONLY=1

# Set the working directory to where we want to install the dependencies; this directory doesn't
# really matter as it will not be present in the final image, but keeping the path short makes
# copying from it easier in the next stage.
WORKDIR /shieldbattery

# Copy the whole repository to the image, *except* the stuff marked in the `.dockerignore` file
COPY . .

# Install only the root folder's dependencies (`app` dependencies should be built into the
# Electron app). Note that we specifically install non-production dependencies here so that we can
# use them to build the client code. They will be pruned out in a later step.
RUN yarn

# Prebuild the web client assets so we can simply copy them over
ENV NODE_ENV=production
RUN yarn run build-web-client

# Then prune the server deps to only the production ones
RUN yarn

# Clone the `wait-for-it` repository which contains a script we'll copy over to our final image, and
# use it to control our services startup order
RUN git clone https://github.com/vishnubob/wait-for-it.git

# Clone the `s3cmd` repository which contains a script we'll copy over to our final image, and use
# it to sync our public assets to the cloud
RUN git clone https://github.com/s3tools/s3cmd.git

# ---------- 2nd stage ----------
# Second stage copies the built dependencies from first stage and runs the app in production mode
FROM node:16-alpine
ENV NODE_ENV=production
# Tell the server not to try and run webpack
ENV SB_PREBUILT_ASSETS=true

# Since we're executing some bash scripts (eg. `wait-for-it.sh`) before running the containers using
# this image, we need to install it explicitly because alpine-based images don't have it by default.
# Also, we need python to execute some python scripts (e.g. `s3cmd`).
RUN apk add --no-cache bash logrotate jq python3 py-pip

# Install the dependencies of the `s3cmd` python script
RUN pip3 install python-dateutil

# Set up log rotation
COPY --from=builder /shieldbattery/server/deployment_files/logrotate.conf /etc/logrotate.d/shieldbattery

# Give the logrotate status file to the node user since that's what crond will be running under
RUN touch /var/lib/logrotate.status && chown node:node /var/lib/logrotate.status

# Set the user to `node` for any subsequent `RUN` and `CMD` instructions
USER node

# Set the working directory to the home directory of the `node` user
WORKDIR /home/node/shieldbattery

# Copy just the sources the server needs
COPY --chown=node:node --from=builder /shieldbattery/node_modules ./node_modules
COPY --chown=node:node --from=builder /shieldbattery/common ./common
COPY --chown=node:node --from=builder /shieldbattery/server ./server
COPY --chown=node:node --from=builder /shieldbattery/package.json /shieldbattery/babel.config.json ./
COPY --chown=node:node --from=builder /shieldbattery/babel-register.js /shieldbattery/babel-register.js ./

# Copy the installed dependencies from the first stage
COPY --chown=node:node --from=builder /shieldbattery/wait-for-it/wait-for-it.sh tools/wait-for-it.sh
COPY --chown=node:node --from=builder /shieldbattery/s3cmd/s3cmd tools/s3cmd/s3cmd
COPY --chown=node:node --from=builder /shieldbattery/s3cmd/S3 tools/s3cmd/S3

# Allow the various scripts to be run (necessary when building on Linux)
RUN chmod +x ./server/update_server.sh
RUN chmod +x ./server/testing/run_mailgun.sh

COPY --chown=node:node --from=builder /shieldbattery/server/deployment_files/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Make the various volume locations as the right user (if we let Docker do it they end up owned by
# root and not writeable)
RUN mkdir ./server/logs && mkdir ./server/uploaded_files && mkdir ./server/bw_sprite_data

RUN touch /var/lib/logrotate.status

# http (generally reverse-proxied to)
EXPOSE 5555/tcp

CMD /entrypoint.sh
