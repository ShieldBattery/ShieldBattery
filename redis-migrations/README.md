Folder for redis migrations, that is, whenever the existing stuff that we save in redis needs to
change.

This stuff needs to be run separately from our server. Currently this process is not automated, so
you'll need to run each migration with `babel-node` from the command line.
