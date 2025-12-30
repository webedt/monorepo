/**
 * Tests for shared validation utilities.
 * Covers hex color, icon, language, and category validators.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  HEX_COLOR_REGEX,
  VALID_ICONS,
  isValidHexColor,
  isValidIcon,
  isValidLanguage,
  isValidCategory,
} from '../src/utils/validators/index.js';
import { SNIPPET_LANGUAGES, SNIPPET_CATEGORIES } from '../src/db/index.js';

describe('Validators', () => {
  describe('HEX_COLOR_REGEX', () => {
    it('should match valid hex colors', () => {
      const validColors = ['#000000', '#FFFFFF', '#ff5733', '#ABC123', '#aabbcc'];
      for (const color of validColors) {
        assert.ok(HEX_COLOR_REGEX.test(color), `Expected ${color} to match`);
      }
    });

    it('should not match invalid hex colors', () => {
      const invalidColors = [
        '#FFF',        // 3 chars instead of 6
        '#GGGGGG',     // invalid hex characters
        '000000',      // missing #
        '#0000000',    // 7 chars
        '#00000',      // 5 chars
        'red',         // color name
        '',            // empty
      ];
      for (const color of invalidColors) {
        assert.ok(!HEX_COLOR_REGEX.test(color), `Expected ${color} to not match`);
      }
    });
  });

  describe('isValidHexColor', () => {
    it('should return true for valid hex colors', () => {
      assert.strictEqual(isValidHexColor('#000000'), true);
      assert.strictEqual(isValidHexColor('#FFFFFF'), true);
      assert.strictEqual(isValidHexColor('#ff5733'), true);
      assert.strictEqual(isValidHexColor('#AbCdEf'), true);
    });

    it('should return false for invalid hex colors', () => {
      assert.strictEqual(isValidHexColor('#FFF'), false);
      assert.strictEqual(isValidHexColor('#GGGGGG'), false);
      assert.strictEqual(isValidHexColor('000000'), false);
      assert.strictEqual(isValidHexColor('red'), false);
    });

    it('should return false for non-string values', () => {
      assert.strictEqual(isValidHexColor(null), false);
      assert.strictEqual(isValidHexColor(undefined), false);
      assert.strictEqual(isValidHexColor(123), false);
      assert.strictEqual(isValidHexColor({}), false);
      assert.strictEqual(isValidHexColor([]), false);
    });

    it('should act as a type guard', () => {
      const value: unknown = '#AABBCC';
      if (isValidHexColor(value)) {
        // TypeScript should know value is string here
        const len: number = value.length;
        assert.strictEqual(len, 7);
      } else {
        assert.fail('Expected value to be a valid hex color');
      }
    });
  });

  describe('VALID_ICONS', () => {
    it('should contain expected icon values', () => {
      assert.ok(VALID_ICONS.includes('folder'));
      assert.ok(VALID_ICONS.includes('star'));
      assert.ok(VALID_ICONS.includes('code'));
      assert.ok(VALID_ICONS.includes('bookmark'));
      assert.ok(VALID_ICONS.includes('archive'));
    });

    it('should have exactly 5 icons', () => {
      assert.strictEqual(VALID_ICONS.length, 5);
    });
  });

  describe('isValidIcon', () => {
    it('should return true for all valid icons', () => {
      for (const icon of VALID_ICONS) {
        assert.strictEqual(isValidIcon(icon), true, `Expected ${icon} to be valid`);
      }
    });

    it('should return false for invalid icon names', () => {
      assert.strictEqual(isValidIcon('invalid'), false);
      assert.strictEqual(isValidIcon('file'), false);
      assert.strictEqual(isValidIcon('FOLDER'), false); // case sensitive
      assert.strictEqual(isValidIcon(''), false);
    });

    it('should return false for non-string values', () => {
      assert.strictEqual(isValidIcon(null), false);
      assert.strictEqual(isValidIcon(undefined), false);
      assert.strictEqual(isValidIcon(123), false);
      assert.strictEqual(isValidIcon({}), false);
    });

    it('should act as a type guard', () => {
      const value: unknown = 'folder';
      if (isValidIcon(value)) {
        // TypeScript should know value is ValidIcon here
        const icon: typeof VALID_ICONS[number] = value;
        assert.strictEqual(icon, 'folder');
      } else {
        assert.fail('Expected value to be a valid icon');
      }
    });
  });

  describe('isValidLanguage', () => {
    it('should return true for all valid languages', () => {
      for (const lang of SNIPPET_LANGUAGES) {
        assert.strictEqual(isValidLanguage(lang), true, `Expected ${lang} to be valid`);
      }
    });

    it('should return true for common languages', () => {
      assert.strictEqual(isValidLanguage('javascript'), true);
      assert.strictEqual(isValidLanguage('typescript'), true);
      assert.strictEqual(isValidLanguage('python'), true);
      assert.strictEqual(isValidLanguage('java'), true);
      assert.strictEqual(isValidLanguage('other'), true);
    });

    it('should return false for invalid languages', () => {
      assert.strictEqual(isValidLanguage('invalid'), false);
      assert.strictEqual(isValidLanguage('JavaScript'), false); // case sensitive
      assert.strictEqual(isValidLanguage('PYTHON'), false);
      assert.strictEqual(isValidLanguage(''), false);
    });

    it('should return false for non-string values', () => {
      assert.strictEqual(isValidLanguage(null), false);
      assert.strictEqual(isValidLanguage(undefined), false);
      assert.strictEqual(isValidLanguage(123), false);
      assert.strictEqual(isValidLanguage({}), false);
      assert.strictEqual(isValidLanguage([]), false);
    });

    it('should act as a type guard', () => {
      const value: unknown = 'typescript';
      if (isValidLanguage(value)) {
        // TypeScript should know value is SnippetLanguage here
        const lang: typeof SNIPPET_LANGUAGES[number] = value;
        assert.strictEqual(lang, 'typescript');
      } else {
        assert.fail('Expected value to be a valid language');
      }
    });
  });

  describe('isValidCategory', () => {
    it('should return true for all valid categories', () => {
      for (const cat of SNIPPET_CATEGORIES) {
        assert.strictEqual(isValidCategory(cat), true, `Expected ${cat} to be valid`);
      }
    });

    it('should return true for common categories', () => {
      assert.strictEqual(isValidCategory('function'), true);
      assert.strictEqual(isValidCategory('class'), true);
      assert.strictEqual(isValidCategory('component'), true);
      assert.strictEqual(isValidCategory('utility'), true);
      assert.strictEqual(isValidCategory('snippet'), true);
      assert.strictEqual(isValidCategory('other'), true);
    });

    it('should return false for invalid categories', () => {
      assert.strictEqual(isValidCategory('invalid'), false);
      assert.strictEqual(isValidCategory('Function'), false); // case sensitive
      assert.strictEqual(isValidCategory('CLASS'), false);
      assert.strictEqual(isValidCategory(''), false);
    });

    it('should return false for non-string values', () => {
      assert.strictEqual(isValidCategory(null), false);
      assert.strictEqual(isValidCategory(undefined), false);
      assert.strictEqual(isValidCategory(123), false);
      assert.strictEqual(isValidCategory({}), false);
      assert.strictEqual(isValidCategory([]), false);
    });

    it('should act as a type guard', () => {
      const value: unknown = 'function';
      if (isValidCategory(value)) {
        // TypeScript should know value is SnippetCategory here
        const cat: typeof SNIPPET_CATEGORIES[number] = value;
        assert.strictEqual(cat, 'function');
      } else {
        assert.fail('Expected value to be a valid category');
      }
    });
  });
});
