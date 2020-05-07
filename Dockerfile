# ---------- 1st stage ----------
# The first stage adds the necessary libraries to build native add-ons (eg. bcrypt) and then installs
# the server dependencies
FROM node:12-alpine as builder

# By default, `alpine` images don't have necessary tools to install native add-ons, so we use the
# multistage build to install the necessary tools, and build the dependencies which will then be
# copied over to the next stage (this stage will be discarded, along with the installed tools, to
# make the image lighter).
RUN apk add --no-cache python make g++ git

# Ensure that we don't spend time installing dependencies that are only needed for the client
# application.
ENV SB_SERVER_ONLY=1

# Set the working directory to where we want to install the dependencies; this directory doesn't
# really matter as it will not be present in the final image, but keeping the path short makes
# copying from it easier in the next stage.
WORKDIR /shieldbattery

# Copy the whole repository to the image, *except* the stuff marked in the `.dockerignore` file
COPY . .

# Install only the server and main dependencies (`app` dependencies should be built into the
# Electron app) and install only production dependencies to make the image smaller. Note that we
# specifically install non-production dependencies here so that we can use them to build the client
# code. They will be pruned out in a later step.
RUN cd server && yarn && cd .. && yarn

# Prebuild the server assets so we can simply copy them over
ENV NODE_ENV=production
RUN cd server && yarn run build-client && cd ..

# Then prune the server deps to only the production ones
RUN cd server && yarn && cd ..

# Clone the `wait-for-it` repository which contains a script we'll copy over to our final image, and
# use it to control our services startup order
RUN git clone https://github.com/vishnubob/wait-for-it.git

# ---------- 2nd stage ----------
# Second stage copies the built dependencies from first stage and runs the app in production mode
FROM node:12-alpine
ENV NODE_ENV=production
# Tell the server not to try and run webpack
ENV SB_PREBUILT_ASSETS=true

# Since we're executing some bash scripts (eg. `wait-for-it.sh`) before running the containers using
# this image, we need to install it explicitly because alpine-based images don't have it by default.
RUN apk add --no-cache bash

# Set the user to `node` for any subsequent `RUN` and `CMD` instructions
USER node

# Set the working directory to the home directory of the `node` user
WORKDIR /home/node/shieldbattery

# Copy just the sources the server needs
COPY --chown=node:node --from=builder /shieldbattery/server ./server
COPY --chown=node:node --from=builder /shieldbattery/app ./app
# This is a dumb hack to make our server's deps available to things in app/common/
# TODO(tec27): This would ideally just be a symlink to save on image size, but gives a permission
# error for reasons I don't understand, so for now we just copy it all twice
COPY --chown=node:node --from=builder /shieldbattery/server/node_modules ./node_modules

# Copy the installed dependencies from the first stage
COPY --chown=node:node --from=builder /shieldbattery/wait-for-it/wait-for-it.sh tools/wait-for-it.sh

# Make the various volume locations as the right user (if we let Docker do it they end up owned by
# root and not writeable)
RUN mkdir ./server/logs && mkdir ./server/uploaded_files && mkdir ./server/bw_sprite_data && mkdir ./server/public/published_artifacts

# http (generally reverse-proxied to)
EXPOSE 5555/tcp

# Slight optimization, see: https://github.com/nodejs/docker-node/blob/master/docs/BestPractices.md#cmd
CMD cd server && node index.js | ./node_modules/.bin/bunyan
