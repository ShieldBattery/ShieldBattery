This folder contains the code generated from
[Google APIs](https://github.com/googleapis/googleapis) protobuf definitions. For now we're only enerating code pertaining to Google Cloud Vision API as that is the only API we're using.
Unfortunately, the script that we use to generate code doesn't follow the `import` statements, so
we had to painstakingly select the files by hand. Hopefully this process won't have to be repeated
often, but in case you do need to do it, here are the steps.

First, install the [protoc](https://grpc.io/docs/protoc-installation/) compiler and make sure it's
available in your `PATH`.

Then, clone the [Google APIs](https://github.com/googleapis/googleapis) repository.

In the cloned repository, run the following command:

```
yarn add grpc-tools ts-protoc-gen
```

Next, you need to download the `protoc-gen-js.exe` binary from _somewhere_. One way to do it is by
going to the
[protobuf-javascript](https://github.com/protocolbuffers/protobuf-javascript/releases) and
extracting it from their releases. The command below assumes you extracted it to the root folder of
the Google APIs repository you cloned.

Then, make sure you create an empty `proto` folder in the Google APIs repository you cloned where
the generated code will be saved to (it won't work if the folder doesn't exist already).

Finally, after having all of the dependencies, you can run the following command from the root
folder of the cloned Google APIs repository (make sure you pay attention to all of the paths, they can be real fucky on Windows):

```sh
protoc \
  --plugin=protoc-gen-js=.\\protoc-gen-js.exe \
  --plugin=protoc-gen-ts=.\\node_modules\\.bin\\protoc-gen-ts.cmd \
  --plugin=protoc-gen-grpc=.\\node_modules\\.bin\\grpc_tools_node_protoc_plugin.cmd \
  --js_out=import_style=commonjs:./proto \
  --grpc_out=grpc_js:./proto \
  --ts_out=service=grpc-node,mode=grpc-js:./proto \
  ./google/cloud/vision/v1/image_annotator.proto
```

This will generate the code from `image_annotator.proto` definitions and save it to the `proto`
folder. Keep in mind that this will only generate code for that specific protobuf file, it will
*not* follow the `import` statements that are in it. To generate the code for all of the imports,
you will need to repeat the above command for everything you need. Thankfully, wildcard characters
and glob patterns are also available to speed up the process.
