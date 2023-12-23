// package: google.cloud.vision.v1
// file: google/cloud/vision/v1/product_search_service.proto

import * as jspb from "google-protobuf";
import * as google_api_annotations_pb from "../../../../google/api/annotations_pb";
import * as google_api_client_pb from "../../../../google/api/client_pb";
import * as google_api_field_behavior_pb from "../../../../google/api/field_behavior_pb";
import * as google_api_resource_pb from "../../../../google/api/resource_pb";
import * as google_cloud_vision_v1_geometry_pb from "../../../../google/cloud/vision/v1/geometry_pb";
import * as google_longrunning_operations_pb from "../../../../google/longrunning/operations_pb";
import * as google_protobuf_empty_pb from "google-protobuf/google/protobuf/empty_pb";
import * as google_protobuf_field_mask_pb from "google-protobuf/google/protobuf/field_mask_pb";
import * as google_protobuf_timestamp_pb from "google-protobuf/google/protobuf/timestamp_pb";
import * as google_rpc_status_pb from "../../../../google/rpc/status_pb";

export class Product extends jspb.Message {
  getName(): string;
  setName(value: string): void;

  getDisplayName(): string;
  setDisplayName(value: string): void;

  getDescription(): string;
  setDescription(value: string): void;

  getProductCategory(): string;
  setProductCategory(value: string): void;

  clearProductLabelsList(): void;
  getProductLabelsList(): Array<Product.KeyValue>;
  setProductLabelsList(value: Array<Product.KeyValue>): void;
  addProductLabels(value?: Product.KeyValue, index?: number): Product.KeyValue;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): Product.AsObject;
  static toObject(includeInstance: boolean, msg: Product): Product.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: Product, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): Product;
  static deserializeBinaryFromReader(message: Product, reader: jspb.BinaryReader): Product;
}

export namespace Product {
  export type AsObject = {
    name: string,
    displayName: string,
    description: string,
    productCategory: string,
    productLabelsList: Array<Product.KeyValue.AsObject>,
  }

  export class KeyValue extends jspb.Message {
    getKey(): string;
    setKey(value: string): void;

    getValue(): string;
    setValue(value: string): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): KeyValue.AsObject;
    static toObject(includeInstance: boolean, msg: KeyValue): KeyValue.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: KeyValue, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): KeyValue;
    static deserializeBinaryFromReader(message: KeyValue, reader: jspb.BinaryReader): KeyValue;
  }

  export namespace KeyValue {
    export type AsObject = {
      key: string,
      value: string,
    }
  }
}

export class ProductSet extends jspb.Message {
  getName(): string;
  setName(value: string): void;

  getDisplayName(): string;
  setDisplayName(value: string): void;

  hasIndexTime(): boolean;
  clearIndexTime(): void;
  getIndexTime(): google_protobuf_timestamp_pb.Timestamp | undefined;
  setIndexTime(value?: google_protobuf_timestamp_pb.Timestamp): void;

  hasIndexError(): boolean;
  clearIndexError(): void;
  getIndexError(): google_rpc_status_pb.Status | undefined;
  setIndexError(value?: google_rpc_status_pb.Status): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ProductSet.AsObject;
  static toObject(includeInstance: boolean, msg: ProductSet): ProductSet.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ProductSet, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ProductSet;
  static deserializeBinaryFromReader(message: ProductSet, reader: jspb.BinaryReader): ProductSet;
}

export namespace ProductSet {
  export type AsObject = {
    name: string,
    displayName: string,
    indexTime?: google_protobuf_timestamp_pb.Timestamp.AsObject,
    indexError?: google_rpc_status_pb.Status.AsObject,
  }
}

export class ReferenceImage extends jspb.Message {
  getName(): string;
  setName(value: string): void;

  getUri(): string;
  setUri(value: string): void;

  clearBoundingPolysList(): void;
  getBoundingPolysList(): Array<google_cloud_vision_v1_geometry_pb.BoundingPoly>;
  setBoundingPolysList(value: Array<google_cloud_vision_v1_geometry_pb.BoundingPoly>): void;
  addBoundingPolys(value?: google_cloud_vision_v1_geometry_pb.BoundingPoly, index?: number): google_cloud_vision_v1_geometry_pb.BoundingPoly;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ReferenceImage.AsObject;
  static toObject(includeInstance: boolean, msg: ReferenceImage): ReferenceImage.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ReferenceImage, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ReferenceImage;
  static deserializeBinaryFromReader(message: ReferenceImage, reader: jspb.BinaryReader): ReferenceImage;
}

export namespace ReferenceImage {
  export type AsObject = {
    name: string,
    uri: string,
    boundingPolysList: Array<google_cloud_vision_v1_geometry_pb.BoundingPoly.AsObject>,
  }
}

export class CreateProductRequest extends jspb.Message {
  getParent(): string;
  setParent(value: string): void;

  hasProduct(): boolean;
  clearProduct(): void;
  getProduct(): Product | undefined;
  setProduct(value?: Product): void;

  getProductId(): string;
  setProductId(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): CreateProductRequest.AsObject;
  static toObject(includeInstance: boolean, msg: CreateProductRequest): CreateProductRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: CreateProductRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): CreateProductRequest;
  static deserializeBinaryFromReader(message: CreateProductRequest, reader: jspb.BinaryReader): CreateProductRequest;
}

export namespace CreateProductRequest {
  export type AsObject = {
    parent: string,
    product?: Product.AsObject,
    productId: string,
  }
}

export class ListProductsRequest extends jspb.Message {
  getParent(): string;
  setParent(value: string): void;

  getPageSize(): number;
  setPageSize(value: number): void;

  getPageToken(): string;
  setPageToken(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ListProductsRequest.AsObject;
  static toObject(includeInstance: boolean, msg: ListProductsRequest): ListProductsRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ListProductsRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ListProductsRequest;
  static deserializeBinaryFromReader(message: ListProductsRequest, reader: jspb.BinaryReader): ListProductsRequest;
}

export namespace ListProductsRequest {
  export type AsObject = {
    parent: string,
    pageSize: number,
    pageToken: string,
  }
}

export class ListProductsResponse extends jspb.Message {
  clearProductsList(): void;
  getProductsList(): Array<Product>;
  setProductsList(value: Array<Product>): void;
  addProducts(value?: Product, index?: number): Product;

  getNextPageToken(): string;
  setNextPageToken(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ListProductsResponse.AsObject;
  static toObject(includeInstance: boolean, msg: ListProductsResponse): ListProductsResponse.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ListProductsResponse, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ListProductsResponse;
  static deserializeBinaryFromReader(message: ListProductsResponse, reader: jspb.BinaryReader): ListProductsResponse;
}

export namespace ListProductsResponse {
  export type AsObject = {
    productsList: Array<Product.AsObject>,
    nextPageToken: string,
  }
}

export class GetProductRequest extends jspb.Message {
  getName(): string;
  setName(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): GetProductRequest.AsObject;
  static toObject(includeInstance: boolean, msg: GetProductRequest): GetProductRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: GetProductRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): GetProductRequest;
  static deserializeBinaryFromReader(message: GetProductRequest, reader: jspb.BinaryReader): GetProductRequest;
}

export namespace GetProductRequest {
  export type AsObject = {
    name: string,
  }
}

export class UpdateProductRequest extends jspb.Message {
  hasProduct(): boolean;
  clearProduct(): void;
  getProduct(): Product | undefined;
  setProduct(value?: Product): void;

  hasUpdateMask(): boolean;
  clearUpdateMask(): void;
  getUpdateMask(): google_protobuf_field_mask_pb.FieldMask | undefined;
  setUpdateMask(value?: google_protobuf_field_mask_pb.FieldMask): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): UpdateProductRequest.AsObject;
  static toObject(includeInstance: boolean, msg: UpdateProductRequest): UpdateProductRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: UpdateProductRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): UpdateProductRequest;
  static deserializeBinaryFromReader(message: UpdateProductRequest, reader: jspb.BinaryReader): UpdateProductRequest;
}

export namespace UpdateProductRequest {
  export type AsObject = {
    product?: Product.AsObject,
    updateMask?: google_protobuf_field_mask_pb.FieldMask.AsObject,
  }
}

export class DeleteProductRequest extends jspb.Message {
  getName(): string;
  setName(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): DeleteProductRequest.AsObject;
  static toObject(includeInstance: boolean, msg: DeleteProductRequest): DeleteProductRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: DeleteProductRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): DeleteProductRequest;
  static deserializeBinaryFromReader(message: DeleteProductRequest, reader: jspb.BinaryReader): DeleteProductRequest;
}

export namespace DeleteProductRequest {
  export type AsObject = {
    name: string,
  }
}

export class CreateProductSetRequest extends jspb.Message {
  getParent(): string;
  setParent(value: string): void;

  hasProductSet(): boolean;
  clearProductSet(): void;
  getProductSet(): ProductSet | undefined;
  setProductSet(value?: ProductSet): void;

  getProductSetId(): string;
  setProductSetId(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): CreateProductSetRequest.AsObject;
  static toObject(includeInstance: boolean, msg: CreateProductSetRequest): CreateProductSetRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: CreateProductSetRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): CreateProductSetRequest;
  static deserializeBinaryFromReader(message: CreateProductSetRequest, reader: jspb.BinaryReader): CreateProductSetRequest;
}

export namespace CreateProductSetRequest {
  export type AsObject = {
    parent: string,
    productSet?: ProductSet.AsObject,
    productSetId: string,
  }
}

export class ListProductSetsRequest extends jspb.Message {
  getParent(): string;
  setParent(value: string): void;

  getPageSize(): number;
  setPageSize(value: number): void;

  getPageToken(): string;
  setPageToken(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ListProductSetsRequest.AsObject;
  static toObject(includeInstance: boolean, msg: ListProductSetsRequest): ListProductSetsRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ListProductSetsRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ListProductSetsRequest;
  static deserializeBinaryFromReader(message: ListProductSetsRequest, reader: jspb.BinaryReader): ListProductSetsRequest;
}

export namespace ListProductSetsRequest {
  export type AsObject = {
    parent: string,
    pageSize: number,
    pageToken: string,
  }
}

export class ListProductSetsResponse extends jspb.Message {
  clearProductSetsList(): void;
  getProductSetsList(): Array<ProductSet>;
  setProductSetsList(value: Array<ProductSet>): void;
  addProductSets(value?: ProductSet, index?: number): ProductSet;

  getNextPageToken(): string;
  setNextPageToken(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ListProductSetsResponse.AsObject;
  static toObject(includeInstance: boolean, msg: ListProductSetsResponse): ListProductSetsResponse.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ListProductSetsResponse, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ListProductSetsResponse;
  static deserializeBinaryFromReader(message: ListProductSetsResponse, reader: jspb.BinaryReader): ListProductSetsResponse;
}

export namespace ListProductSetsResponse {
  export type AsObject = {
    productSetsList: Array<ProductSet.AsObject>,
    nextPageToken: string,
  }
}

export class GetProductSetRequest extends jspb.Message {
  getName(): string;
  setName(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): GetProductSetRequest.AsObject;
  static toObject(includeInstance: boolean, msg: GetProductSetRequest): GetProductSetRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: GetProductSetRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): GetProductSetRequest;
  static deserializeBinaryFromReader(message: GetProductSetRequest, reader: jspb.BinaryReader): GetProductSetRequest;
}

export namespace GetProductSetRequest {
  export type AsObject = {
    name: string,
  }
}

export class UpdateProductSetRequest extends jspb.Message {
  hasProductSet(): boolean;
  clearProductSet(): void;
  getProductSet(): ProductSet | undefined;
  setProductSet(value?: ProductSet): void;

  hasUpdateMask(): boolean;
  clearUpdateMask(): void;
  getUpdateMask(): google_protobuf_field_mask_pb.FieldMask | undefined;
  setUpdateMask(value?: google_protobuf_field_mask_pb.FieldMask): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): UpdateProductSetRequest.AsObject;
  static toObject(includeInstance: boolean, msg: UpdateProductSetRequest): UpdateProductSetRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: UpdateProductSetRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): UpdateProductSetRequest;
  static deserializeBinaryFromReader(message: UpdateProductSetRequest, reader: jspb.BinaryReader): UpdateProductSetRequest;
}

export namespace UpdateProductSetRequest {
  export type AsObject = {
    productSet?: ProductSet.AsObject,
    updateMask?: google_protobuf_field_mask_pb.FieldMask.AsObject,
  }
}

export class DeleteProductSetRequest extends jspb.Message {
  getName(): string;
  setName(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): DeleteProductSetRequest.AsObject;
  static toObject(includeInstance: boolean, msg: DeleteProductSetRequest): DeleteProductSetRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: DeleteProductSetRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): DeleteProductSetRequest;
  static deserializeBinaryFromReader(message: DeleteProductSetRequest, reader: jspb.BinaryReader): DeleteProductSetRequest;
}

export namespace DeleteProductSetRequest {
  export type AsObject = {
    name: string,
  }
}

export class CreateReferenceImageRequest extends jspb.Message {
  getParent(): string;
  setParent(value: string): void;

  hasReferenceImage(): boolean;
  clearReferenceImage(): void;
  getReferenceImage(): ReferenceImage | undefined;
  setReferenceImage(value?: ReferenceImage): void;

  getReferenceImageId(): string;
  setReferenceImageId(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): CreateReferenceImageRequest.AsObject;
  static toObject(includeInstance: boolean, msg: CreateReferenceImageRequest): CreateReferenceImageRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: CreateReferenceImageRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): CreateReferenceImageRequest;
  static deserializeBinaryFromReader(message: CreateReferenceImageRequest, reader: jspb.BinaryReader): CreateReferenceImageRequest;
}

export namespace CreateReferenceImageRequest {
  export type AsObject = {
    parent: string,
    referenceImage?: ReferenceImage.AsObject,
    referenceImageId: string,
  }
}

export class ListReferenceImagesRequest extends jspb.Message {
  getParent(): string;
  setParent(value: string): void;

  getPageSize(): number;
  setPageSize(value: number): void;

  getPageToken(): string;
  setPageToken(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ListReferenceImagesRequest.AsObject;
  static toObject(includeInstance: boolean, msg: ListReferenceImagesRequest): ListReferenceImagesRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ListReferenceImagesRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ListReferenceImagesRequest;
  static deserializeBinaryFromReader(message: ListReferenceImagesRequest, reader: jspb.BinaryReader): ListReferenceImagesRequest;
}

export namespace ListReferenceImagesRequest {
  export type AsObject = {
    parent: string,
    pageSize: number,
    pageToken: string,
  }
}

export class ListReferenceImagesResponse extends jspb.Message {
  clearReferenceImagesList(): void;
  getReferenceImagesList(): Array<ReferenceImage>;
  setReferenceImagesList(value: Array<ReferenceImage>): void;
  addReferenceImages(value?: ReferenceImage, index?: number): ReferenceImage;

  getPageSize(): number;
  setPageSize(value: number): void;

  getNextPageToken(): string;
  setNextPageToken(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ListReferenceImagesResponse.AsObject;
  static toObject(includeInstance: boolean, msg: ListReferenceImagesResponse): ListReferenceImagesResponse.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ListReferenceImagesResponse, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ListReferenceImagesResponse;
  static deserializeBinaryFromReader(message: ListReferenceImagesResponse, reader: jspb.BinaryReader): ListReferenceImagesResponse;
}

export namespace ListReferenceImagesResponse {
  export type AsObject = {
    referenceImagesList: Array<ReferenceImage.AsObject>,
    pageSize: number,
    nextPageToken: string,
  }
}

export class GetReferenceImageRequest extends jspb.Message {
  getName(): string;
  setName(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): GetReferenceImageRequest.AsObject;
  static toObject(includeInstance: boolean, msg: GetReferenceImageRequest): GetReferenceImageRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: GetReferenceImageRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): GetReferenceImageRequest;
  static deserializeBinaryFromReader(message: GetReferenceImageRequest, reader: jspb.BinaryReader): GetReferenceImageRequest;
}

export namespace GetReferenceImageRequest {
  export type AsObject = {
    name: string,
  }
}

export class DeleteReferenceImageRequest extends jspb.Message {
  getName(): string;
  setName(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): DeleteReferenceImageRequest.AsObject;
  static toObject(includeInstance: boolean, msg: DeleteReferenceImageRequest): DeleteReferenceImageRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: DeleteReferenceImageRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): DeleteReferenceImageRequest;
  static deserializeBinaryFromReader(message: DeleteReferenceImageRequest, reader: jspb.BinaryReader): DeleteReferenceImageRequest;
}

export namespace DeleteReferenceImageRequest {
  export type AsObject = {
    name: string,
  }
}

export class AddProductToProductSetRequest extends jspb.Message {
  getName(): string;
  setName(value: string): void;

  getProduct(): string;
  setProduct(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): AddProductToProductSetRequest.AsObject;
  static toObject(includeInstance: boolean, msg: AddProductToProductSetRequest): AddProductToProductSetRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: AddProductToProductSetRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): AddProductToProductSetRequest;
  static deserializeBinaryFromReader(message: AddProductToProductSetRequest, reader: jspb.BinaryReader): AddProductToProductSetRequest;
}

export namespace AddProductToProductSetRequest {
  export type AsObject = {
    name: string,
    product: string,
  }
}

export class RemoveProductFromProductSetRequest extends jspb.Message {
  getName(): string;
  setName(value: string): void;

  getProduct(): string;
  setProduct(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): RemoveProductFromProductSetRequest.AsObject;
  static toObject(includeInstance: boolean, msg: RemoveProductFromProductSetRequest): RemoveProductFromProductSetRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: RemoveProductFromProductSetRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): RemoveProductFromProductSetRequest;
  static deserializeBinaryFromReader(message: RemoveProductFromProductSetRequest, reader: jspb.BinaryReader): RemoveProductFromProductSetRequest;
}

export namespace RemoveProductFromProductSetRequest {
  export type AsObject = {
    name: string,
    product: string,
  }
}

export class ListProductsInProductSetRequest extends jspb.Message {
  getName(): string;
  setName(value: string): void;

  getPageSize(): number;
  setPageSize(value: number): void;

  getPageToken(): string;
  setPageToken(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ListProductsInProductSetRequest.AsObject;
  static toObject(includeInstance: boolean, msg: ListProductsInProductSetRequest): ListProductsInProductSetRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ListProductsInProductSetRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ListProductsInProductSetRequest;
  static deserializeBinaryFromReader(message: ListProductsInProductSetRequest, reader: jspb.BinaryReader): ListProductsInProductSetRequest;
}

export namespace ListProductsInProductSetRequest {
  export type AsObject = {
    name: string,
    pageSize: number,
    pageToken: string,
  }
}

export class ListProductsInProductSetResponse extends jspb.Message {
  clearProductsList(): void;
  getProductsList(): Array<Product>;
  setProductsList(value: Array<Product>): void;
  addProducts(value?: Product, index?: number): Product;

  getNextPageToken(): string;
  setNextPageToken(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ListProductsInProductSetResponse.AsObject;
  static toObject(includeInstance: boolean, msg: ListProductsInProductSetResponse): ListProductsInProductSetResponse.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ListProductsInProductSetResponse, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ListProductsInProductSetResponse;
  static deserializeBinaryFromReader(message: ListProductsInProductSetResponse, reader: jspb.BinaryReader): ListProductsInProductSetResponse;
}

export namespace ListProductsInProductSetResponse {
  export type AsObject = {
    productsList: Array<Product.AsObject>,
    nextPageToken: string,
  }
}

export class ImportProductSetsGcsSource extends jspb.Message {
  getCsvFileUri(): string;
  setCsvFileUri(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ImportProductSetsGcsSource.AsObject;
  static toObject(includeInstance: boolean, msg: ImportProductSetsGcsSource): ImportProductSetsGcsSource.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ImportProductSetsGcsSource, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ImportProductSetsGcsSource;
  static deserializeBinaryFromReader(message: ImportProductSetsGcsSource, reader: jspb.BinaryReader): ImportProductSetsGcsSource;
}

export namespace ImportProductSetsGcsSource {
  export type AsObject = {
    csvFileUri: string,
  }
}

export class ImportProductSetsInputConfig extends jspb.Message {
  hasGcsSource(): boolean;
  clearGcsSource(): void;
  getGcsSource(): ImportProductSetsGcsSource | undefined;
  setGcsSource(value?: ImportProductSetsGcsSource): void;

  getSourceCase(): ImportProductSetsInputConfig.SourceCase;
  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ImportProductSetsInputConfig.AsObject;
  static toObject(includeInstance: boolean, msg: ImportProductSetsInputConfig): ImportProductSetsInputConfig.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ImportProductSetsInputConfig, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ImportProductSetsInputConfig;
  static deserializeBinaryFromReader(message: ImportProductSetsInputConfig, reader: jspb.BinaryReader): ImportProductSetsInputConfig;
}

export namespace ImportProductSetsInputConfig {
  export type AsObject = {
    gcsSource?: ImportProductSetsGcsSource.AsObject,
  }

  export enum SourceCase {
    SOURCE_NOT_SET = 0,
    GCS_SOURCE = 1,
  }
}

export class ImportProductSetsRequest extends jspb.Message {
  getParent(): string;
  setParent(value: string): void;

  hasInputConfig(): boolean;
  clearInputConfig(): void;
  getInputConfig(): ImportProductSetsInputConfig | undefined;
  setInputConfig(value?: ImportProductSetsInputConfig): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ImportProductSetsRequest.AsObject;
  static toObject(includeInstance: boolean, msg: ImportProductSetsRequest): ImportProductSetsRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ImportProductSetsRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ImportProductSetsRequest;
  static deserializeBinaryFromReader(message: ImportProductSetsRequest, reader: jspb.BinaryReader): ImportProductSetsRequest;
}

export namespace ImportProductSetsRequest {
  export type AsObject = {
    parent: string,
    inputConfig?: ImportProductSetsInputConfig.AsObject,
  }
}

export class ImportProductSetsResponse extends jspb.Message {
  clearReferenceImagesList(): void;
  getReferenceImagesList(): Array<ReferenceImage>;
  setReferenceImagesList(value: Array<ReferenceImage>): void;
  addReferenceImages(value?: ReferenceImage, index?: number): ReferenceImage;

  clearStatusesList(): void;
  getStatusesList(): Array<google_rpc_status_pb.Status>;
  setStatusesList(value: Array<google_rpc_status_pb.Status>): void;
  addStatuses(value?: google_rpc_status_pb.Status, index?: number): google_rpc_status_pb.Status;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ImportProductSetsResponse.AsObject;
  static toObject(includeInstance: boolean, msg: ImportProductSetsResponse): ImportProductSetsResponse.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ImportProductSetsResponse, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ImportProductSetsResponse;
  static deserializeBinaryFromReader(message: ImportProductSetsResponse, reader: jspb.BinaryReader): ImportProductSetsResponse;
}

export namespace ImportProductSetsResponse {
  export type AsObject = {
    referenceImagesList: Array<ReferenceImage.AsObject>,
    statusesList: Array<google_rpc_status_pb.Status.AsObject>,
  }
}

export class BatchOperationMetadata extends jspb.Message {
  getState(): BatchOperationMetadata.StateMap[keyof BatchOperationMetadata.StateMap];
  setState(value: BatchOperationMetadata.StateMap[keyof BatchOperationMetadata.StateMap]): void;

  hasSubmitTime(): boolean;
  clearSubmitTime(): void;
  getSubmitTime(): google_protobuf_timestamp_pb.Timestamp | undefined;
  setSubmitTime(value?: google_protobuf_timestamp_pb.Timestamp): void;

  hasEndTime(): boolean;
  clearEndTime(): void;
  getEndTime(): google_protobuf_timestamp_pb.Timestamp | undefined;
  setEndTime(value?: google_protobuf_timestamp_pb.Timestamp): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): BatchOperationMetadata.AsObject;
  static toObject(includeInstance: boolean, msg: BatchOperationMetadata): BatchOperationMetadata.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: BatchOperationMetadata, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): BatchOperationMetadata;
  static deserializeBinaryFromReader(message: BatchOperationMetadata, reader: jspb.BinaryReader): BatchOperationMetadata;
}

export namespace BatchOperationMetadata {
  export type AsObject = {
    state: BatchOperationMetadata.StateMap[keyof BatchOperationMetadata.StateMap],
    submitTime?: google_protobuf_timestamp_pb.Timestamp.AsObject,
    endTime?: google_protobuf_timestamp_pb.Timestamp.AsObject,
  }

  export interface StateMap {
    STATE_UNSPECIFIED: 0;
    PROCESSING: 1;
    SUCCESSFUL: 2;
    FAILED: 3;
    CANCELLED: 4;
  }

  export const State: StateMap;
}

export class ProductSetPurgeConfig extends jspb.Message {
  getProductSetId(): string;
  setProductSetId(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ProductSetPurgeConfig.AsObject;
  static toObject(includeInstance: boolean, msg: ProductSetPurgeConfig): ProductSetPurgeConfig.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ProductSetPurgeConfig, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ProductSetPurgeConfig;
  static deserializeBinaryFromReader(message: ProductSetPurgeConfig, reader: jspb.BinaryReader): ProductSetPurgeConfig;
}

export namespace ProductSetPurgeConfig {
  export type AsObject = {
    productSetId: string,
  }
}

export class PurgeProductsRequest extends jspb.Message {
  hasProductSetPurgeConfig(): boolean;
  clearProductSetPurgeConfig(): void;
  getProductSetPurgeConfig(): ProductSetPurgeConfig | undefined;
  setProductSetPurgeConfig(value?: ProductSetPurgeConfig): void;

  hasDeleteOrphanProducts(): boolean;
  clearDeleteOrphanProducts(): void;
  getDeleteOrphanProducts(): boolean;
  setDeleteOrphanProducts(value: boolean): void;

  getParent(): string;
  setParent(value: string): void;

  getForce(): boolean;
  setForce(value: boolean): void;

  getTargetCase(): PurgeProductsRequest.TargetCase;
  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): PurgeProductsRequest.AsObject;
  static toObject(includeInstance: boolean, msg: PurgeProductsRequest): PurgeProductsRequest.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: PurgeProductsRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): PurgeProductsRequest;
  static deserializeBinaryFromReader(message: PurgeProductsRequest, reader: jspb.BinaryReader): PurgeProductsRequest;
}

export namespace PurgeProductsRequest {
  export type AsObject = {
    productSetPurgeConfig?: ProductSetPurgeConfig.AsObject,
    deleteOrphanProducts: boolean,
    parent: string,
    force: boolean,
  }

  export enum TargetCase {
    TARGET_NOT_SET = 0,
    PRODUCT_SET_PURGE_CONFIG = 2,
    DELETE_ORPHAN_PRODUCTS = 3,
  }
}

