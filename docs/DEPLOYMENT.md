# Deploying ShieldBattery Servers

This document will outline the steps necessary to successfully deploy a new version of ShieldBattery servers. For now it's only possible to deploy two different flavors of the server, `production` and `staging`. Due to ShieldBattery's architecture, both the Windows and Linux operating systems are required to successfully deploy a server. Windows is required to build the game code and the electron application, while the Linux is used to actually run the server.

Since we're using virtualized containers (and their implementation through Docker) as our deployment strategy, these two steps need to be done separately, as explained below. But first, a short introduction of Docker basics, or at least enough to make sense of things we use in ShieldBattery.

## Docker basics

There are two key things necessary for understanding Docker that we use in Shieldbattery's deployment process, and in Docker's terminology, they are:

- images
- containers

An _image_ is basically an executable package that includes everything needed to run an application. A _container_ is an instance of an image, ie. what happens when you run an image (and yes, you can run the same image multiple times, in different containers). Images are built from a file called `Dockerfile`, which is a template that describes everything that an image should contain and what it should do. Containers are defined through a file called `docker-compose.yml`, which is a config file that describes how to run images in a container (Docker terminology technically calls them services, but that distinction is not that important now).

So for example, a `docker-compose.yml` file could define services (ie. containers), that would run all the different images your application needs to run (eg. nginx, redis, postgres, and of course, an image that runs your own application defined and created through a `Dockerfile`). `Docker-compose` will first try to see if an image is available locally, and if it's not, it will try to pull it from its [official image repository](https://hub.docker.com/) (`Docker-compose` also has an option to build an image automatically if you supply it a location to a `Dockerfile`). While it _is_ technically possible to just have one image in which you install all the necessary software (including stuff like postgres, redis, etc.), images should be kept small so they're easier to reuse and transfer (and also easier to scale up in the future if need be).

Another important thing to understand about Docker is that the containers generally can only be run on the matching operating system of their host machine. This means that if a container is running an image which uses Linux as its base image, then that container will need to be run from a Linux machine as well. This is technically not true though, because Windows supports running Linux containers, but it does so by internally creating a Linux virtual machine, which is not that helpful, since you can't run both the Windows and Linux containers at the same time, but must choose which to run (it still makes our deployment process much easier as you'll see below).

Finally, there's another concept that's pretty important to understand how it works which hasn't been mentioned before. And that's the concept of sharing files, or even the whole folders, between a running Docker container and the host machine on which it is running. Docker has solved this problem through something called `volumes`, and those volumes allows us to persist some things (eg. database data) through container shutting down and starting again. You can read more about the volumes, and other storage methods in the Docker's [documentation](https://docs.docker.com/storage/).

## Building the server image

As said above, this is the first step that needs to be done when deploying the new version of ShieldBattery servers. And for reasons also mentioned above, this step needs to be done on a Windows operating system.

### Install the required software

Setup the environment necessary to build the game code and the electron application, as explained in our [getting started](./GETTING_STARTED.md) guide.

Install the [Docker Desktop](https://docs.docker.com/docker-for-windows/) application and make sure to choose "Use Linux containers" option when offerred (should be the default).

Optionally, create an account on Docker's [official image repository](https://hub.docker.com/) where the built image will be uploaded.

### Run the deployment script

Use the included `deploy.bat` script to build the image. To run it, figure out what the desired
version string is (this should usually match the package.json), then do:

```
.\deploy.bat <VERSION>
```

The name of the built image will be `shieldbattery/shieldbattery`, tagged with
the following:

- NPM package version, `shieldbattery/shieldbattery:x.y.z`
- Git SHA, `shieldbattery/shieldbattery:1234deadbeef12341234deadbeef1234`
- latest, `shieldbattery/shieldbattery:latest`

NOTE: The deploy script doesn't particularly care which branch you're trying to
deploy, so be careful to check out the right one before deploying.

### Cleanup

Note that if when you create images, Docker will keep them around locally. You can check what images
you have by running:

```
docker images
```

and remove specific ones by running:

```
docker image rm [-f] IMAGE_ID
```

You can also let it prune what is no longer necessary with:

```
docker image prune
```

(This won't, however, generally remove images that you created previously).

## Running the server image inside a Docker container

This is the second (and final) step in our deployment process. This step should be done on a Linux operating system, generally on the publicly available machine that's used to host the servers.

### Start the server

Upload the entire `deployment` folder at the root of this repository to the target server.

Rename `sample.env` to `.env` and update the values to match your desired configuration.

To start the server, simply run docker compose from the console:

```
docker-compose up
```

This command will output the log messages of all services right into the console. You can also start
the server in the background, by running docker compose in the detached mode:

```
docker-compose up -d
```

This starts up all the necessary services, so provided everything has been configured correctly, the
application should "just work" after running this command.

To see more commands you can use with docker compose, check out [this link](https://docs.docker.com/compose/reference/overview/).

### Import the existing database

If you have some existing data that you'd wish to import into the database, you'll have to do it manually. The following steps will help you achieve that.

1. Make sure you have a dump of the data that you wish to import. You can obtain the dump by running:

```
pg_dump --data-only DBNAME > outfile
```

2. Once the containers are running, restore the data:

```
cat outfile | docker exec -i shieldbattery_db_1 psql -U postgres --dbname DBNAME
```

NOTE: For this to work, the schema of the target database MUST match the schema of the source
database. This means you should run any necessary migrations before dumping the data, or use a
properly versioned container image if one is available.

### Copy existing uploaded_files content

Upload the backed up `uploaded_files` directory to the new server. Note that it **must** be named
`uploaded_files`. From the directory containing it, run:

```
sudo docker cp uploaded_files/ shieldbattery_app_server_1:/home/node/shieldbattery/server/
```

The backed up content will now be present in the correct volume, and can be deleted from the
location you uploaded it to.

### Deploying new client versions

Upload the packed content under `dist/nsis-web/` to the `published_artifacts/win/` folder on the
target folder. Make sure to keep the `ShieldBattery.latest.exe` file as a copy of the latest
installer so that all the relevant page links work.

## Further improvements

### Better startup control

Docker offers a way for one service to wait for another service before starting. However, their mechanism doesn't wait for other services to actually be "ready" before starting a service that depends on those services, because the "ready" state is subjective to each service.

In the current version of our `docker-compose.yml` file, we've utilized a [third party script](https://github.com/vishnubob/wait-for-it) to wait for the service that contains the database to actually be ready before running the server migrations. Perhaps we should extend this to other services as well, eg. actually wait for `redis` service to be ready before starting the server. However, I have not noticed any problems so far so it might be an overkill.

### Healthcheck

Docker also offers a way to perform a health check when trying to run a container which can make it easier to spot when a service falls down. Not sure what we could be testing here off the top of my head, but it's good to have an option and be mindful of it in future.

To read more about this option in Docker documentation, check out [this link](https://docs.docker.com/compose/compose-file/#healthcheck) and [this link](https://docs.docker.com/engine/reference/builder/#healthcheck)
