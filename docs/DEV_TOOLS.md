# Dev Tools

## Using Developer Tools with Electron

Electron 9+ causes problems with using various developer tools on non-http pages (which is how our
application is designed to work). Because of this, we stopped installing both the Redux and React
developer tools. Should you still need/want to use them, there are alternative ways to do so.

### React Developer Tools

This set of developer tools can be used as a separate application. To run it, use:

```
npx react-devtools
```

This will install the application (if necessary) and run it. Afterwards it will wait for a
connection from our Electon app. To make our app connect, you need to set the `SB_REACT_DEV`
environment variable. On Windows this can be done by running:

```
set SB_REACT_DEV=1
```

Any instances of our app launched from that terminal will then connect to the remote devtools.

### Redux Developer Tools

This set of developer tools are manually integrated into our application, instead of using a browser
extension as it was done previously. To show/hide it, use the following hotkey inside application:

```
ctrl + h
```

To change the default position of the overlay, use the following hotkey:

```
ctrl + q
```
