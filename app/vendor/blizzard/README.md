The Typescript files here are generated using the following command:

```sh
protoc --plugin=protoc-gen-ts_proto=".\\node_modules\\.bin\\protoc-gen-ts_proto.cmd" --ts_proto_out=. --ts_proto_opt=env=node,forceLong=bigint,esModuleInterop=true .\app\vendor\blizzard\product_db.proto
```

Must install protoc to utilize it: https://grpc.io/docs/protoc-installation/

Generally these should not need to be regenerated.
