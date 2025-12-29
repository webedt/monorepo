/**
 * Image Export Module
 * Provides export functionality for various image formats
 */

export { exportToOra } from './oraExporter';
export { exportToPsd } from './psdExporter';

export type { OraExportOptions } from './oraExporter';
export type { PsdExportOptions } from './psdExporter';

/**
 * Supported export formats
 */
export type ExportFormat = 'png' | 'jpg' | 'ora' | 'psd';

/**
 * Format metadata
 */
export const formatInfo: Record<ExportFormat, { name: string; extension: string; mimeType: string; description: string }> = {
  png: {
    name: 'PNG',
    extension: '.png',
    mimeType: 'image/png',
    description: 'Lossless format with transparency',
  },
  jpg: {
    name: 'JPEG',
    extension: '.jpg',
    mimeType: 'image/jpeg',
    description: 'Compressed format for photos',
  },
  ora: {
    name: 'OpenRaster',
    extension: '.ora',
    mimeType: 'image/openraster',
    description: 'Open format with layers (GIMP, Krita)',
  },
  psd: {
    name: 'Photoshop',
    extension: '.psd',
    mimeType: 'image/vnd.adobe.photoshop',
    description: 'Adobe Photoshop format with layers',
  },
};
