/**
 * ORA (OpenRaster) Exporter
 * Creates OpenRaster files compatible with GIMP, Krita, and other applications
 *
 * ORA format specification: https://www.openraster.org/
 */

import JSZip from 'jszip';

import type { Layer } from '../../stores/imageLayersStore';
import type { BlendMode } from '../../stores/imageLayersStore';

/**
 * Maps our blend modes to ORA composite-op values
 * See: https://www.w3.org/TR/compositing-1/#blending
 */
function blendModeToCompositeOp(blendMode: BlendMode): string {
  const mapping: Record<BlendMode, string> = {
    'normal': 'svg:src-over',
    'multiply': 'svg:multiply',
    'screen': 'svg:screen',
    'overlay': 'svg:overlay',
    'darken': 'svg:darken',
    'lighten': 'svg:lighten',
    'color-dodge': 'svg:color-dodge',
    'color-burn': 'svg:color-burn',
    'hard-light': 'svg:hard-light',
    'soft-light': 'svg:soft-light',
    'difference': 'svg:difference',
    'exclusion': 'svg:exclusion',
  };
  return mapping[blendMode] || 'svg:src-over';
}

/**
 * Convert a canvas to a PNG blob
 */
async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to convert canvas to blob'));
        }
      },
      'image/png',
      1
    );
  });
}

/**
 * Create a thumbnail from a canvas
 */
function createThumbnail(canvas: HTMLCanvasElement, maxSize: number = 256): HTMLCanvasElement {
  const aspectRatio = canvas.width / canvas.height;
  let width: number;
  let height: number;

  if (canvas.width > canvas.height) {
    width = Math.min(canvas.width, maxSize);
    height = width / aspectRatio;
  } else {
    height = Math.min(canvas.height, maxSize);
    width = height * aspectRatio;
  }

  const thumbnail = document.createElement('canvas');
  thumbnail.width = width;
  thumbnail.height = height;

  const ctx = thumbnail.getContext('2d');
  if (ctx) {
    ctx.drawImage(canvas, 0, 0, width, height);
  }

  return thumbnail;
}

/**
 * Generate the stack.xml content for ORA
 */
function generateStackXml(
  layers: Layer[],
  width: number,
  height: number
): string {
  const xmlParts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<image version="0.0.3" w="${width}" h="${height}" xres="72" yres="72">`,
    ' <stack opacity="1.0" composite-op="svg:src-over">',
  ];

  // Layers are stored bottom to top in our array, but ORA expects top to bottom in XML
  const reversedLayers = [...layers].reverse();

  reversedLayers.forEach((layer, index) => {
    const layerIndex = layers.length - 1 - index;
    const compositeOp = blendModeToCompositeOp(layer.blendMode);
    const visibility = layer.visible ? 'visible' : 'hidden';

    xmlParts.push(
      `  <layer name="${escapeXml(layer.name)}" ` +
        `src="data/layer${layerIndex}.png" ` +
        `opacity="${layer.opacity.toFixed(2)}" ` +
        `composite-op="${compositeOp}" ` +
        `visibility="${visibility}" ` +
        `x="0" y="0" />`
    );
  });

  xmlParts.push(' </stack>', '</image>');

  return xmlParts.join('\n');
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface OraExportOptions {
  includeThumbnail?: boolean;
  includeMergedImage?: boolean;
}

/**
 * Export layers to ORA format
 * @param layers Array of layers to export
 * @param width Canvas width
 * @param height Canvas height
 * @param compositeCanvas Canvas with merged/composited image
 * @param options Export options
 * @returns ORA file as a Blob
 */
export async function exportToOra(
  layers: Layer[],
  width: number,
  height: number,
  compositeCanvas: HTMLCanvasElement,
  options: OraExportOptions = {}
): Promise<Blob> {
  const { includeThumbnail = true, includeMergedImage = true } = options;

  const zip = new JSZip();

  // Add mimetype file (must be first and uncompressed per ORA spec)
  zip.file('mimetype', 'image/openraster', { compression: 'STORE' });

  // Add stack.xml
  const stackXml = generateStackXml(layers, width, height);
  zip.file('stack.xml', stackXml);

  // Create data folder and add layer PNGs
  const dataFolder = zip.folder('data');
  if (!dataFolder) {
    throw new Error('Failed to create data folder in ZIP');
  }

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const pngBlob = await canvasToPngBlob(layer.canvas);
    dataFolder.file(`layer${i}.png`, pngBlob);
  }

  // Add merged image
  if (includeMergedImage) {
    const mergedBlob = await canvasToPngBlob(compositeCanvas);
    zip.file('mergedimage.png', mergedBlob);
  }

  // Add thumbnail
  if (includeThumbnail) {
    const thumbnailsFolder = zip.folder('Thumbnails');
    if (thumbnailsFolder) {
      const thumbnail = createThumbnail(compositeCanvas);
      const thumbnailBlob = await canvasToPngBlob(thumbnail);
      thumbnailsFolder.file('thumbnail.png', thumbnailBlob);
      // Clean up
      thumbnail.width = 0;
      thumbnail.height = 0;
    }
  }

  // Generate the ZIP file
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'image/openraster',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return blob;
}
