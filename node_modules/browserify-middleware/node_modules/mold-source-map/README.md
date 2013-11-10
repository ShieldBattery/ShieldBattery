# mold-source-map [![build status](https://secure.travis-ci.org/thlorenz/mold-source-map.png)](http://travis-ci.org/thlorenz/mold-source-map)

Mold a source map that is almost perfect for you into one that is.

```js
var path       =  require('path')
  , fs         =  require('fs')
  , browserify =  require('browserify')
  , mold       =  require('mold-source-map')
  , bundlePath =  path.join(__dirname, 'project', 'js', 'build', 'bundle.js')
  , jsRoot     =  path.join(__dirname, 'project');

browserify()
  .require(require.resolve('./project/js/main.js'), { entry: true })
  .bundle({ debug: true })
  .on('error', function (err) { console.error(err); })

  // will show all source files relative to jsRoot inside devtools
  .pipe(mold.sourcesRelative(jsRoot))
  .pipe(fs.createWriteStream(bundlePath));
```

## Installation

    npm install mold-source-map

## API

### Transforms

Transforms return a duplex stream and are therefore easily threaded into a bundler that streams the generated bundle,
like [browserify](https://github.com/substack/node-browserify).

#### transform(function map(sourcemap[, callback]) {})

This is the most generic an powerfull feature as it allows replacing the entire sourcemap comment with another `String`.

It takes a map function as input whose `sourcemap` argument has all information and lots of functions regarding the existing source map.

The optional `callback` can be used to call back with the final source map comment. If it is given, the transform will
invoke the function asynchronously, otherwise you may just return the final source map comment.

Here is a snippet from [an example](https://github.com/thlorenz/mold-source-map/blob/master/examples/browserify-external-map-file-sync.js) 
showing how to use this in order to write out an external map file and point the browser to it:

```js
function mapFileUrlCommentSync(sourcemap) {
  
  // make source files appear under the following paths:
  // /js
  //    foo.js
  //    main.js
  // /js/wunder
  //    bar.js 

  sourcemap.sourceRoot('file://'); 
  sourcemap.mapSources(mold.mapPathRelativeTo(jsRoot));

  // write map file and return a sourceMappingUrl that points to it
  fs.writeFileSync(mapFilePath, sourcemap.toJSON(2), 'utf-8');
  return '//@ sourceMappingURL=' + mapFilePath;
}

browserify()
  .require(require.resolve('./project/js/main.js'), { entry: true })
  .bundle({ debug: true })
  .on('error', function (err) { console.error(err); })
  .pipe(mold.transform(mapFileUrlCommentSync))
  .pipe(fs.createWriteStream(bundlePath));
```

The below are convenience transforms for special use cases. They all could be archieved with the generic transform as
well.

### transformSourcesRelative(root)

```
/**
 * Adjusts all sources paths inside the source map contained in the content that is piped to it.
 *
 * Example: bundleStream.pipe(mold.sourcesRelative(root)).pipe(fs.createWriteStream(bundlePath))
 *
 * @name sourcesRelative
 * @function
 * @param root {String} The path to make sources relative to.
 * @return {Stream} A duplex stream that writes out content with source map that had all sources paths adjusted.
 */
 ```

## Unstable API

A more custom/advanced API will be/is exposed, however it is still in high fluctuation.

Take a look at the `index.js` to get an idea of what's coming/already there.
