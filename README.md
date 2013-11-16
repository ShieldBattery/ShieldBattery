#manner-pylon
The official server for [shieldbattery](https://github.com/tec27/shieldbattery). Currently supports user account creation and lobby system for custom games. More stuff to come soon!

##Developer Setup
Manner-pylon is written completely in JavaScript utilizing the AngularJS framework and various NodeJS modules.

####Localhost Setup
To setup manner-pylon on your localhost you will need [postgres](http://www.postgresql.org/) and [redis](http://redis.io/). Additionally, you will need to create a self-signed certificate and add it to your trusted root CA. You will also need to edit some settings in `config.example.js` and `database.example.js` files which are explained below and then rename those files to `config.js` and `database.json` respectively.

Once you install postgres, make sure you have an account which you'll need to edit into the `database.json` file. After that, just run the `db-migrate` file from the command prompt which will create an appropriate database and tables in your postgres.

To install redis on Windows you're gonna have to jump through some hoops, but if you follow these instructions it should be no problem. First, you'll have to fork [this project](https://github.com/MSOpenTech/redis) and build the RedisServer solution (open the `redis\msvs\install\readme.txt` file if you need help) to get the MSI installer. However, you're probably gonna need to build the RedisWatcher solution separately first and for that you're gonna need to have [WiX Toolset](http://wixtoolset.org/) installed. Once you have redis installed, it could be useful to make the service out of redis-server program so you don't have to start it manually every time you want to use manner-pylon. For that you can use [this](http://nssm.cc/).

The final thing is to make a self-signed certificate and add it to your trusted root CA. You can use [OpenSSL](http://www.openssl.org/related/binaries.html) to make the certificate which should be pretty straightforward. Once you have the certificate and its key created, you need to copy them to the `.\certs\` folder and make the adjustments in `config.js` file if needed.

####Running manner-pylon
If you haven't made the redis-server a service, then you're gonna need to start it up manually. Once you've done that, start the manner-pylon server by typing `node index.js` in the command prompt and then navigate to the https://localhost/ to use it.
