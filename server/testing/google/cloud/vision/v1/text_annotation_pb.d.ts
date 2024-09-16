// package: google.cloud.vision.v1
// file: google/cloud/vision/v1/text_annotation.proto

import * as jspb from 'google-protobuf'
import * as google_cloud_vision_v1_geometry_pb from '../../../../google/cloud/vision/v1/geometry_pb.js'

export class TextAnnotation extends jspb.Message {
  clearPagesList(): void
  getPagesList(): Array<Page>
  setPagesList(value: Array<Page>): void
  addPages(value?: Page, index?: number): Page

  getText(): string
  setText(value: string): void

  serializeBinary(): Uint8Array
  toObject(includeInstance?: boolean): TextAnnotation.AsObject
  static toObject(includeInstance: boolean, msg: TextAnnotation): TextAnnotation.AsObject
  static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> }
  static extensionsBinary: { [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message> }
  static serializeBinaryToWriter(message: TextAnnotation, writer: jspb.BinaryWriter): void
  static deserializeBinary(bytes: Uint8Array): TextAnnotation
  static deserializeBinaryFromReader(
    message: TextAnnotation,
    reader: jspb.BinaryReader,
  ): TextAnnotation
}

export namespace TextAnnotation {
  export type AsObject = {
    pagesList: Array<Page.AsObject>
    text: string
  }

  export class DetectedLanguage extends jspb.Message {
    getLanguageCode(): string
    setLanguageCode(value: string): void

    getConfidence(): number
    setConfidence(value: number): void

    serializeBinary(): Uint8Array
    toObject(includeInstance?: boolean): DetectedLanguage.AsObject
    static toObject(includeInstance: boolean, msg: DetectedLanguage): DetectedLanguage.AsObject
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> }
    static extensionsBinary: { [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message> }
    static serializeBinaryToWriter(message: DetectedLanguage, writer: jspb.BinaryWriter): void
    static deserializeBinary(bytes: Uint8Array): DetectedLanguage
    static deserializeBinaryFromReader(
      message: DetectedLanguage,
      reader: jspb.BinaryReader,
    ): DetectedLanguage
  }

  export namespace DetectedLanguage {
    export type AsObject = {
      languageCode: string
      confidence: number
    }
  }

  export class DetectedBreak extends jspb.Message {
    getType(): TextAnnotation.DetectedBreak.BreakTypeMap[keyof TextAnnotation.DetectedBreak.BreakTypeMap]
    setType(
      value: TextAnnotation.DetectedBreak.BreakTypeMap[keyof TextAnnotation.DetectedBreak.BreakTypeMap],
    ): void

    getIsPrefix(): boolean
    setIsPrefix(value: boolean): void

    serializeBinary(): Uint8Array
    toObject(includeInstance?: boolean): DetectedBreak.AsObject
    static toObject(includeInstance: boolean, msg: DetectedBreak): DetectedBreak.AsObject
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> }
    static extensionsBinary: { [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message> }
    static serializeBinaryToWriter(message: DetectedBreak, writer: jspb.BinaryWriter): void
    static deserializeBinary(bytes: Uint8Array): DetectedBreak
    static deserializeBinaryFromReader(
      message: DetectedBreak,
      reader: jspb.BinaryReader,
    ): DetectedBreak
  }

  export namespace DetectedBreak {
    export type AsObject = {
      type: TextAnnotation.DetectedBreak.BreakTypeMap[keyof TextAnnotation.DetectedBreak.BreakTypeMap]
      isPrefix: boolean
    }

    export interface BreakTypeMap {
      UNKNOWN: 0
      SPACE: 1
      SURE_SPACE: 2
      EOL_SURE_SPACE: 3
      HYPHEN: 4
      LINE_BREAK: 5
    }

    export const BreakType: BreakTypeMap
  }

  export class TextProperty extends jspb.Message {
    clearDetectedLanguagesList(): void
    getDetectedLanguagesList(): Array<TextAnnotation.DetectedLanguage>
    setDetectedLanguagesList(value: Array<TextAnnotation.DetectedLanguage>): void
    addDetectedLanguages(
      value?: TextAnnotation.DetectedLanguage,
      index?: number,
    ): TextAnnotation.DetectedLanguage

    hasDetectedBreak(): boolean
    clearDetectedBreak(): void
    getDetectedBreak(): TextAnnotation.DetectedBreak | undefined
    setDetectedBreak(value?: TextAnnotation.DetectedBreak): void

    serializeBinary(): Uint8Array
    toObject(includeInstance?: boolean): TextProperty.AsObject
    static toObject(includeInstance: boolean, msg: TextProperty): TextProperty.AsObject
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> }
    static extensionsBinary: { [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message> }
    static serializeBinaryToWriter(message: TextProperty, writer: jspb.BinaryWriter): void
    static deserializeBinary(bytes: Uint8Array): TextProperty
    static deserializeBinaryFromReader(
      message: TextProperty,
      reader: jspb.BinaryReader,
    ): TextProperty
  }

  export namespace TextProperty {
    export type AsObject = {
      detectedLanguagesList: Array<TextAnnotation.DetectedLanguage.AsObject>
      detectedBreak?: TextAnnotation.DetectedBreak.AsObject
    }
  }
}

export class Page extends jspb.Message {
  hasProperty(): boolean
  clearProperty(): void
  getProperty(): TextAnnotation.TextProperty | undefined
  setProperty(value?: TextAnnotation.TextProperty): void

  getWidth(): number
  setWidth(value: number): void

  getHeight(): number
  setHeight(value: number): void

  clearBlocksList(): void
  getBlocksList(): Array<Block>
  setBlocksList(value: Array<Block>): void
  addBlocks(value?: Block, index?: number): Block

  getConfidence(): number
  setConfidence(value: number): void

  serializeBinary(): Uint8Array
  toObject(includeInstance?: boolean): Page.AsObject
  static toObject(includeInstance: boolean, msg: Page): Page.AsObject
  static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> }
  static extensionsBinary: { [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message> }
  static serializeBinaryToWriter(message: Page, writer: jspb.BinaryWriter): void
  static deserializeBinary(bytes: Uint8Array): Page
  static deserializeBinaryFromReader(message: Page, reader: jspb.BinaryReader): Page
}

export namespace Page {
  export type AsObject = {
    property?: TextAnnotation.TextProperty.AsObject
    width: number
    height: number
    blocksList: Array<Block.AsObject>
    confidence: number
  }
}

export class Block extends jspb.Message {
  hasProperty(): boolean
  clearProperty(): void
  getProperty(): TextAnnotation.TextProperty | undefined
  setProperty(value?: TextAnnotation.TextProperty): void

  hasBoundingBox(): boolean
  clearBoundingBox(): void
  getBoundingBox(): google_cloud_vision_v1_geometry_pb.BoundingPoly | undefined
  setBoundingBox(value?: google_cloud_vision_v1_geometry_pb.BoundingPoly): void

  clearParagraphsList(): void
  getParagraphsList(): Array<Paragraph>
  setParagraphsList(value: Array<Paragraph>): void
  addParagraphs(value?: Paragraph, index?: number): Paragraph

  getBlockType(): Block.BlockTypeMap[keyof Block.BlockTypeMap]
  setBlockType(value: Block.BlockTypeMap[keyof Block.BlockTypeMap]): void

  getConfidence(): number
  setConfidence(value: number): void

  serializeBinary(): Uint8Array
  toObject(includeInstance?: boolean): Block.AsObject
  static toObject(includeInstance: boolean, msg: Block): Block.AsObject
  static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> }
  static extensionsBinary: { [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message> }
  static serializeBinaryToWriter(message: Block, writer: jspb.BinaryWriter): void
  static deserializeBinary(bytes: Uint8Array): Block
  static deserializeBinaryFromReader(message: Block, reader: jspb.BinaryReader): Block
}

export namespace Block {
  export type AsObject = {
    property?: TextAnnotation.TextProperty.AsObject
    boundingBox?: google_cloud_vision_v1_geometry_pb.BoundingPoly.AsObject
    paragraphsList: Array<Paragraph.AsObject>
    blockType: Block.BlockTypeMap[keyof Block.BlockTypeMap]
    confidence: number
  }

  export interface BlockTypeMap {
    UNKNOWN: 0
    TEXT: 1
    TABLE: 2
    PICTURE: 3
    RULER: 4
    BARCODE: 5
  }

  export const BlockType: BlockTypeMap
}

export class Paragraph extends jspb.Message {
  hasProperty(): boolean
  clearProperty(): void
  getProperty(): TextAnnotation.TextProperty | undefined
  setProperty(value?: TextAnnotation.TextProperty): void

  hasBoundingBox(): boolean
  clearBoundingBox(): void
  getBoundingBox(): google_cloud_vision_v1_geometry_pb.BoundingPoly | undefined
  setBoundingBox(value?: google_cloud_vision_v1_geometry_pb.BoundingPoly): void

  clearWordsList(): void
  getWordsList(): Array<Word>
  setWordsList(value: Array<Word>): void
  addWords(value?: Word, index?: number): Word

  getConfidence(): number
  setConfidence(value: number): void

  serializeBinary(): Uint8Array
  toObject(includeInstance?: boolean): Paragraph.AsObject
  static toObject(includeInstance: boolean, msg: Paragraph): Paragraph.AsObject
  static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> }
  static extensionsBinary: { [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message> }
  static serializeBinaryToWriter(message: Paragraph, writer: jspb.BinaryWriter): void
  static deserializeBinary(bytes: Uint8Array): Paragraph
  static deserializeBinaryFromReader(message: Paragraph, reader: jspb.BinaryReader): Paragraph
}

export namespace Paragraph {
  export type AsObject = {
    property?: TextAnnotation.TextProperty.AsObject
    boundingBox?: google_cloud_vision_v1_geometry_pb.BoundingPoly.AsObject
    wordsList: Array<Word.AsObject>
    confidence: number
  }
}

export class Word extends jspb.Message {
  hasProperty(): boolean
  clearProperty(): void
  getProperty(): TextAnnotation.TextProperty | undefined
  setProperty(value?: TextAnnotation.TextProperty): void

  hasBoundingBox(): boolean
  clearBoundingBox(): void
  getBoundingBox(): google_cloud_vision_v1_geometry_pb.BoundingPoly | undefined
  setBoundingBox(value?: google_cloud_vision_v1_geometry_pb.BoundingPoly): void

  clearSymbolsList(): void
  getSymbolsList(): Array<Symbol>
  setSymbolsList(value: Array<Symbol>): void
  addSymbols(value?: Symbol, index?: number): Symbol

  getConfidence(): number
  setConfidence(value: number): void

  serializeBinary(): Uint8Array
  toObject(includeInstance?: boolean): Word.AsObject
  static toObject(includeInstance: boolean, msg: Word): Word.AsObject
  static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> }
  static extensionsBinary: { [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message> }
  static serializeBinaryToWriter(message: Word, writer: jspb.BinaryWriter): void
  static deserializeBinary(bytes: Uint8Array): Word
  static deserializeBinaryFromReader(message: Word, reader: jspb.BinaryReader): Word
}

export namespace Word {
  export type AsObject = {
    property?: TextAnnotation.TextProperty.AsObject
    boundingBox?: google_cloud_vision_v1_geometry_pb.BoundingPoly.AsObject
    symbolsList: Array<Symbol.AsObject>
    confidence: number
  }
}

export class Symbol extends jspb.Message {
  hasProperty(): boolean
  clearProperty(): void
  getProperty(): TextAnnotation.TextProperty | undefined
  setProperty(value?: TextAnnotation.TextProperty): void

  hasBoundingBox(): boolean
  clearBoundingBox(): void
  getBoundingBox(): google_cloud_vision_v1_geometry_pb.BoundingPoly | undefined
  setBoundingBox(value?: google_cloud_vision_v1_geometry_pb.BoundingPoly): void

  getText(): string
  setText(value: string): void

  getConfidence(): number
  setConfidence(value: number): void

  serializeBinary(): Uint8Array
  toObject(includeInstance?: boolean): Symbol.AsObject
  static toObject(includeInstance: boolean, msg: Symbol): Symbol.AsObject
  static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> }
  static extensionsBinary: { [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message> }
  static serializeBinaryToWriter(message: Symbol, writer: jspb.BinaryWriter): void
  static deserializeBinary(bytes: Uint8Array): Symbol
  static deserializeBinaryFromReader(message: Symbol, reader: jspb.BinaryReader): Symbol
}

export namespace Symbol {
  export type AsObject = {
    property?: TextAnnotation.TextProperty.AsObject
    boundingBox?: google_cloud_vision_v1_geometry_pb.BoundingPoly.AsObject
    text: string
    confidence: number
  }
}
