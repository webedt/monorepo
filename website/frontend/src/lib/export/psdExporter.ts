/**
 * PSD (Photoshop Document) Exporter
 * Creates PSD files compatible with Adobe Photoshop and other applications
 *
 * Based on Adobe Photoshop File Format Specification
 * Supports: layers, opacity, blend modes, visibility
 */

import type { Layer } from '../../stores/imageLayersStore';
import type { BlendMode } from '../../stores/imageLayersStore';

/**
 * Maps our blend modes to PSD blend mode keys (4 characters)
 * Note: PSD uses non-intuitive keys - 'smud' is Adobe's key for exclusion blend mode
 * Reference: Adobe Photoshop File Format Specification
 */
function blendModeToPsdKey(blendMode: BlendMode): string {
  const mapping: Record<BlendMode, string> = {
    'normal': 'norm',
    'multiply': 'mul ',
    'screen': 'scrn',
    'overlay': 'over',
    'darken': 'dark',
    'lighten': 'lite',
    'color-dodge': 'div ',
    'color-burn': 'idiv',
    'hard-light': 'hLit',
    'soft-light': 'sLit',
    'difference': 'diff',
    'exclusion': 'smud', // Adobe PSD uses 'smud' for exclusion blend mode
  };
  return mapping[blendMode] || 'norm';
}

/**
 * DataView writer helper for building binary data
 */
class BinaryWriter {
  private buffer: ArrayBuffer;
  private view: DataView;
  private offset: number;
  private chunks: ArrayBuffer[];

  constructor(initialSize: number = 1024) {
    this.buffer = new ArrayBuffer(initialSize);
    this.view = new DataView(this.buffer);
    this.offset = 0;
    this.chunks = [];
  }

  private ensureCapacity(bytes: number): void {
    if (this.offset + bytes > this.buffer.byteLength) {
      // Save current buffer as chunk and create new one
      this.chunks.push(this.buffer.slice(0, this.offset));
      const newSize = Math.max(bytes, this.buffer.byteLength * 2);
      this.buffer = new ArrayBuffer(newSize);
      this.view = new DataView(this.buffer);
      this.offset = 0;
    }
  }

  writeUint8(value: number): void {
    this.ensureCapacity(1);
    this.view.setUint8(this.offset, value);
    this.offset += 1;
  }

  writeUint16(value: number): void {
    this.ensureCapacity(2);
    this.view.setUint16(this.offset, value, false); // Big endian
    this.offset += 2;
  }

  writeUint32(value: number): void {
    this.ensureCapacity(4);
    this.view.setUint32(this.offset, value, false); // Big endian
    this.offset += 4;
  }

  writeInt16(value: number): void {
    this.ensureCapacity(2);
    this.view.setInt16(this.offset, value, false);
    this.offset += 2;
  }

  writeInt32(value: number): void {
    this.ensureCapacity(4);
    this.view.setInt32(this.offset, value, false);
    this.offset += 4;
  }

  writeString(str: string, length?: number): void {
    const len = length ?? str.length;
    this.ensureCapacity(len);
    for (let i = 0; i < len; i++) {
      this.view.setUint8(this.offset + i, i < str.length ? str.charCodeAt(i) : 0);
    }
    this.offset += len;
  }

  writePascalString(str: string, padTo: number = 4): void {
    const nameBytes = new TextEncoder().encode(str);
    const length = nameBytes.length;
    // Write length byte
    this.writeUint8(length);
    // Write string bytes
    this.writeBytes(nameBytes);
    // Pad to boundary (including length byte)
    const totalLength = 1 + length;
    const padding = (padTo - (totalLength % padTo)) % padTo;
    for (let i = 0; i < padding; i++) {
      this.writeUint8(0);
    }
  }

  writeBytes(bytes: Uint8Array | ArrayBuffer): void {
    const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
    this.ensureCapacity(arr.length);
    for (let i = 0; i < arr.length; i++) {
      this.view.setUint8(this.offset + i, arr[i]);
    }
    this.offset += arr.length;
  }

  writeZeros(count: number): void {
    this.ensureCapacity(count);
    for (let i = 0; i < count; i++) {
      this.view.setUint8(this.offset + i, 0);
    }
    this.offset += count;
  }

  getPosition(): number {
    let totalSize = 0;
    for (const chunk of this.chunks) {
      totalSize += chunk.byteLength;
    }
    return totalSize + this.offset;
  }

  toBlob(): Blob {
    // Combine all chunks with current buffer
    const parts: ArrayBuffer[] = [...this.chunks];
    if (this.offset > 0) {
      parts.push(this.buffer.slice(0, this.offset));
    }
    return new Blob(parts, { type: 'image/vnd.adobe.photoshop' });
  }
}

/**
 * Get image data from a canvas as RGBA
 */
function getCanvasImageData(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * RLE compress a channel (PackBits algorithm)
 * PSD uses a variant of PackBits compression
 */
function rleCompressChannel(data: Uint8Array, width: number, height: number): { compressed: Uint8Array; rowLengths: number[] } {
  const rowLengths: number[] = [];
  const compressedRows: Uint8Array[] = [];

  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    const rowData = data.slice(rowStart, rowStart + width);
    const compressed = packBitsCompress(rowData);
    compressedRows.push(compressed);
    rowLengths.push(compressed.length);
  }

  // Combine all rows
  const totalLength = compressedRows.reduce((sum, row) => sum + row.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const row of compressedRows) {
    result.set(row, offset);
    offset += row.length;
  }

  return { compressed: result, rowLengths };
}

/**
 * PackBits compression for a single row
 */
function packBitsCompress(input: Uint8Array): Uint8Array {
  if (input.length === 0) return new Uint8Array(0);

  const output: number[] = [];
  let i = 0;

  while (i < input.length) {
    // Look for runs of identical bytes
    let runLength = 1;
    while (i + runLength < input.length && runLength < 128 && input[i + runLength] === input[i]) {
      runLength++;
    }

    if (runLength > 1) {
      // Encode run: -(runLength - 1), byte
      output.push(-(runLength - 1) & 0xff);
      output.push(input[i]);
      i += runLength;
    } else {
      // Look for non-repeating sequence
      let literalLength = 1;
      while (
        i + literalLength < input.length &&
        literalLength < 128 &&
        (i + literalLength + 1 >= input.length || input[i + literalLength] !== input[i + literalLength + 1])
      ) {
        literalLength++;
      }

      // Encode literal: (literalLength - 1), bytes...
      output.push(literalLength - 1);
      for (let j = 0; j < literalLength; j++) {
        output.push(input[i + j]);
      }
      i += literalLength;
    }
  }

  return new Uint8Array(output);
}

/**
 * Write PSD header section
 */
function writeHeader(writer: BinaryWriter, width: number, height: number, channels: number): void {
  writer.writeString('8BPS'); // Signature
  writer.writeUint16(1); // Version
  writer.writeZeros(6); // Reserved
  writer.writeUint16(channels); // Number of channels (RGBA = 4)
  writer.writeUint32(height); // Height
  writer.writeUint32(width); // Width
  writer.writeUint16(8); // Bits per channel
  writer.writeUint16(3); // Color mode: RGB
}

/**
 * Write color mode data section (empty for RGB)
 */
function writeColorModeData(writer: BinaryWriter): void {
  writer.writeUint32(0); // Length = 0 for RGB
}

/**
 * Write image resources section (minimal)
 */
function writeImageResources(writer: BinaryWriter): void {
  // For now, write empty resources section
  writer.writeUint32(0);
}

/**
 * Write layer and mask information section
 */
function writeLayerAndMaskInfo(
  writer: BinaryWriter,
  layers: Layer[],
  width: number,
  height: number
): void {
  // Prepare all layer data first
  const layerData: Array<{
    layer: Layer;
    channels: Array<{ id: number; compressed: Uint8Array; rowLengths: number[] }>;
  }> = [];

  for (const layer of layers) {
    // Validate layer canvas dimensions match document dimensions
    if (layer.canvas.width !== width || layer.canvas.height !== height) {
      console.warn(
        `Layer "${layer.name}" dimensions (${layer.canvas.width}x${layer.canvas.height}) ` +
        `don't match document dimensions (${width}x${height}). Using document dimensions.`
      );
    }

    const imageData = getCanvasImageData(layer.canvas);
    const pixelCount = width * height;

    // Extract RGBA channels
    const redChannel = new Uint8Array(pixelCount);
    const greenChannel = new Uint8Array(pixelCount);
    const blueChannel = new Uint8Array(pixelCount);
    const alphaChannel = new Uint8Array(pixelCount);

    for (let i = 0; i < pixelCount; i++) {
      redChannel[i] = imageData.data[i * 4];
      greenChannel[i] = imageData.data[i * 4 + 1];
      blueChannel[i] = imageData.data[i * 4 + 2];
      alphaChannel[i] = imageData.data[i * 4 + 3];
    }

    // Compress each channel
    const channels = [
      { id: -1, ...rleCompressChannel(alphaChannel, width, height) }, // Alpha = -1
      { id: 0, ...rleCompressChannel(redChannel, width, height) }, // Red = 0
      { id: 1, ...rleCompressChannel(greenChannel, width, height) }, // Green = 1
      { id: 2, ...rleCompressChannel(blueChannel, width, height) }, // Blue = 2
    ];

    layerData.push({ layer, channels });
  }

  // Calculate layer info section size
  let layerInfoSize = 0;
  layerInfoSize += 2; // Layer count

  // Layer records
  for (const { layer, channels } of layerData) {
    layerInfoSize += 4 * 4; // Rectangle (top, left, bottom, right)
    layerInfoSize += 2; // Number of channels
    layerInfoSize += channels.length * 6; // Channel info (2 + 4 per channel)
    layerInfoSize += 4; // Blend mode signature '8BIM'
    layerInfoSize += 4; // Blend mode key
    layerInfoSize += 1; // Opacity
    layerInfoSize += 1; // Clipping
    layerInfoSize += 1; // Flags
    layerInfoSize += 1; // Filler

    // Extra data length
    const namePadded = getPaddedNameLength(layer.name);
    const extraDataLen = 4 + 4 + namePadded; // Layer mask (4) + blending ranges (4) + name
    layerInfoSize += 4; // Extra data length field
    layerInfoSize += extraDataLen;
  }

  // Channel image data
  for (const { channels } of layerData) {
    for (const channel of channels) {
      layerInfoSize += 2; // Compression type
      layerInfoSize += height * 2; // Row byte counts
      layerInfoSize += channel.compressed.length; // Compressed data
    }
  }

  // Pad to even
  if (layerInfoSize % 2 !== 0) {
    layerInfoSize++;
  }

  // Write Layer and Mask Information section
  const sectionSize = layerInfoSize + 4; // +4 for layer info length field
  writer.writeUint32(sectionSize); // Section length

  // Layer info
  writer.writeUint32(layerInfoSize); // Layer info length
  writer.writeInt16(layers.length); // Layer count (positive = merged visible)

  // Write layer records
  for (const { layer, channels } of layerData) {
    // Rectangle
    writer.writeInt32(0); // Top
    writer.writeInt32(0); // Left
    writer.writeInt32(height); // Bottom
    writer.writeInt32(width); // Right

    // Number of channels
    writer.writeUint16(channels.length);

    // Channel info
    for (const channel of channels) {
      writer.writeInt16(channel.id);
      const channelDataSize = 2 + height * 2 + channel.compressed.length;
      writer.writeUint32(channelDataSize);
    }

    // Blend mode signature
    writer.writeString('8BIM');

    // Blend mode key
    writer.writeString(blendModeToPsdKey(layer.blendMode));

    // Opacity (0-255)
    writer.writeUint8(Math.round(layer.opacity * 255));

    // Clipping (0 = base, 1 = non-base)
    writer.writeUint8(0);

    // Flags
    let flags = 0;
    if (!layer.visible) flags |= 0x02; // Bit 1: visible (inverted)
    writer.writeUint8(flags);

    // Filler
    writer.writeUint8(0);

    // Extra data
    const namePadded = getPaddedNameLength(layer.name);
    const extraDataLen = 4 + 4 + namePadded;
    writer.writeUint32(extraDataLen);

    // Layer mask data (empty)
    writer.writeUint32(0);

    // Blending ranges (empty)
    writer.writeUint32(0);

    // Layer name (Pascal string padded to 4 bytes)
    writer.writePascalString(layer.name, 4);
  }

  // Write channel image data
  for (const { channels } of layerData) {
    for (const channel of channels) {
      writer.writeUint16(1); // Compression: RLE

      // Row byte counts
      for (const rowLen of channel.rowLengths) {
        writer.writeUint16(rowLen);
      }

      // Compressed data
      writer.writeBytes(channel.compressed);
    }
  }

  // Pad to even if necessary
  if (layerInfoSize % 2 !== 0) {
    writer.writeUint8(0);
  }
}

/**
 * Calculate padded name length for Pascal string (4-byte boundary)
 */
function getPaddedNameLength(name: string): number {
  const nameBytes = new TextEncoder().encode(name);
  const totalLength = 1 + nameBytes.length; // Length byte + name
  const padding = (4 - (totalLength % 4)) % 4;
  return totalLength + padding;
}

/**
 * Write image data section (composite/merged image)
 */
function writeImageData(
  writer: BinaryWriter,
  compositeCanvas: HTMLCanvasElement,
  width: number,
  height: number
): void {
  const imageData = getCanvasImageData(compositeCanvas);
  const pixelCount = width * height;

  // Extract channels
  const redChannel = new Uint8Array(pixelCount);
  const greenChannel = new Uint8Array(pixelCount);
  const blueChannel = new Uint8Array(pixelCount);
  const alphaChannel = new Uint8Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    redChannel[i] = imageData.data[i * 4];
    greenChannel[i] = imageData.data[i * 4 + 1];
    blueChannel[i] = imageData.data[i * 4 + 2];
    alphaChannel[i] = imageData.data[i * 4 + 3];
  }

  // Compress channels
  const compressed = [
    rleCompressChannel(alphaChannel, width, height),
    rleCompressChannel(redChannel, width, height),
    rleCompressChannel(greenChannel, width, height),
    rleCompressChannel(blueChannel, width, height),
  ];

  // Write compression type: RLE
  writer.writeUint16(1);

  // Write all row byte counts first
  for (const channel of compressed) {
    for (const rowLen of channel.rowLengths) {
      writer.writeUint16(rowLen);
    }
  }

  // Write all compressed data
  for (const channel of compressed) {
    writer.writeBytes(channel.compressed);
  }
}

export interface PsdExportOptions {
  includeComposite?: boolean;
}

/**
 * Export layers to PSD format
 * @param layers Array of layers to export
 * @param width Canvas width
 * @param height Canvas height
 * @param compositeCanvas Canvas with merged/composited image
 * @param options Export options
 * @returns PSD file as a Blob
 */
export function exportToPsd(
  layers: Layer[],
  width: number,
  height: number,
  compositeCanvas: HTMLCanvasElement,
  _options: PsdExportOptions = {}
): Blob {
  const writer = new BinaryWriter(1024 * 1024); // 1MB initial buffer

  // 1. Header Section
  writeHeader(writer, width, height, 4); // 4 channels: RGBA

  // 2. Color Mode Data Section
  writeColorModeData(writer);

  // 3. Image Resources Section
  writeImageResources(writer);

  // 4. Layer and Mask Information Section
  writeLayerAndMaskInfo(writer, layers, width, height);

  // 5. Image Data Section (composite image)
  writeImageData(writer, compositeCanvas, width, height);

  return writer.toBlob();
}
