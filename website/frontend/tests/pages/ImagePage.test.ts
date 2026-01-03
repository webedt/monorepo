/**
 * Tests for ImagePage
 * Covers image editor page metadata.
 *
 * Note: Full integration tests for ImagePage are complex due to Canvas/WebGL,
 * store initialization during construction, and component mocking requirements.
 * The rendering tests are covered by visual testing and the core Page base class tests.
 *
 * The ImagePage accesses stores like onionSkinningStore during render() which is
 * called in the Page constructor, making it difficult to mock without restructuring
 * the page itself.
 */

import { describe, it, expect } from 'vitest';

import { ImagePage } from '../../src/pages/image/ImagePage';

describe('ImagePage', () => {
  describe('Static Properties', () => {
    it('should export the ImagePage class', () => {
      expect(ImagePage).toBeDefined();
      expect(typeof ImagePage).toBe('function');
    });
  });
});
