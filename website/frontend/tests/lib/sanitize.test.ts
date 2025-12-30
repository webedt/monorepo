/**
 * Tests for HTML Sanitization Utilities
 * Covers XSS prevention, HTML escaping, and safe template construction.
 */

import { describe, it, expect } from 'vitest';

import {
  sanitizeHtml,
  sanitizeHtmlPermissive,
  escapeText,
  safeHtml,
  SafeHtml,
  containsSuspiciousHtml,
} from '../../src/lib/sanitize';

describe('sanitizeHtml', () => {
  describe('XSS Prevention', () => {
    it('should remove script tags', () => {
      const input = '<script>alert("xss")</script>';
      expect(sanitizeHtml(input)).toBe('');
    });

    it('should remove script tags with content around them', () => {
      const input = 'Hello <script>alert("xss")</script> World';
      expect(sanitizeHtml(input)).toBe('Hello  World');
    });

    it('should remove onclick handlers', () => {
      const input = '<div onclick="alert(1)">Click me</div>';
      expect(sanitizeHtml(input)).toBe('<div>Click me</div>');
    });

    it('should remove onerror handlers', () => {
      const input = '<img src="x" onerror="alert(1)">';
      expect(sanitizeHtml(input)).toBe('<img src="x">');
    });

    it('should remove javascript: URLs in href', () => {
      const input = '<a href="javascript:alert(1)">Click</a>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('javascript:');
    });

    it('should remove data: URLs that could execute code', () => {
      const input = '<a href="data:text/html,<script>alert(1)</script>">Click</a>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('data:');
    });

    it('should remove iframe tags', () => {
      const input = '<iframe src="evil.com"></iframe>';
      expect(sanitizeHtml(input)).toBe('');
    });

    it('should remove object tags', () => {
      const input = '<object data="evil.swf"></object>';
      expect(sanitizeHtml(input)).toBe('');
    });

    it('should remove embed tags', () => {
      const input = '<embed src="evil.swf">';
      expect(sanitizeHtml(input)).toBe('');
    });

    it('should handle case-insensitive attack patterns', () => {
      const input = '<SCRIPT>alert(1)</SCRIPT>';
      expect(sanitizeHtml(input)).toBe('');
    });

    it('should handle encoded attack patterns', () => {
      const input = '<img src=x onerror=&#97;lert(1)>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('onerror');
    });
  });

  describe('Valid Content Preservation', () => {
    it('should preserve basic formatting tags', () => {
      const input = '<p><strong>Bold</strong> and <em>italic</em></p>';
      expect(sanitizeHtml(input)).toBe('<p><strong>Bold</strong> and <em>italic</em></p>');
    });

    it('should preserve links with safe attributes', () => {
      const input = '<a href="https://example.com" title="Example">Link</a>';
      expect(sanitizeHtml(input)).toContain('href="https://example.com"');
      expect(sanitizeHtml(input)).toContain('title="Example"');
    });

    it('should preserve images with safe attributes', () => {
      const input = '<img src="image.png" alt="Description">';
      expect(sanitizeHtml(input)).toBe('<img src="image.png" alt="Description">');
    });

    it('should preserve headings', () => {
      const input = '<h1>Title</h1><h2>Subtitle</h2>';
      expect(sanitizeHtml(input)).toBe('<h1>Title</h1><h2>Subtitle</h2>');
    });

    it('should preserve lists', () => {
      const input = '<ul><li>Item 1</li><li>Item 2</li></ul>';
      expect(sanitizeHtml(input)).toBe('<ul><li>Item 1</li><li>Item 2</li></ul>');
    });

    it('should preserve tables', () => {
      const input = '<table><tr><th>Header</th></tr><tr><td>Cell</td></tr></table>';
      expect(sanitizeHtml(input)).toContain('<table>');
      expect(sanitizeHtml(input)).toContain('<th>Header</th>');
      expect(sanitizeHtml(input)).toContain('<td>Cell</td>');
    });

    it('should preserve code blocks', () => {
      const input = '<pre><code>const x = 1;</code></pre>';
      expect(sanitizeHtml(input)).toBe('<pre><code>const x = 1;</code></pre>');
    });

    it('should preserve class and id attributes', () => {
      const input = '<div class="container" id="main">Content</div>';
      expect(sanitizeHtml(input)).toBe('<div class="container" id="main">Content</div>');
    });
  });

  describe('Edge Cases', () => {
    it('should return empty string for null-like input', () => {
      expect(sanitizeHtml('')).toBe('');
      expect(sanitizeHtml(null as unknown as string)).toBe('');
      expect(sanitizeHtml(undefined as unknown as string)).toBe('');
    });

    it('should handle plain text without HTML', () => {
      const input = 'Just plain text';
      expect(sanitizeHtml(input)).toBe('Just plain text');
    });

    it('should handle deeply nested content', () => {
      const input = '<div><div><div><p>Deep</p></div></div></div>';
      expect(sanitizeHtml(input)).toBe('<div><div><div><p>Deep</p></div></div></div>');
    });
  });
});

describe('sanitizeHtmlPermissive', () => {
  describe('Dangerous Elements Removed', () => {
    it('should remove script tags', () => {
      const input = '<script>alert(1)</script>';
      expect(sanitizeHtmlPermissive(input)).toBe('');
    });

    it('should remove style tags', () => {
      const input = '<style>body { display: none }</style>';
      expect(sanitizeHtmlPermissive(input)).toBe('');
    });

    it('should remove iframe tags', () => {
      const input = '<iframe src="evil.com"></iframe>';
      expect(sanitizeHtmlPermissive(input)).toBe('');
    });

    it('should remove base tags', () => {
      const input = '<base href="https://evil.com">';
      expect(sanitizeHtmlPermissive(input)).toBe('');
    });

    it('should remove meta tags', () => {
      const input = '<meta http-equiv="refresh" content="0;url=evil.com">';
      expect(sanitizeHtmlPermissive(input)).toBe('');
    });

    it('should remove link tags', () => {
      const input = '<link rel="stylesheet" href="evil.css">';
      expect(sanitizeHtmlPermissive(input)).toBe('');
    });

    it('should remove noscript tags', () => {
      const input = '<noscript><img src="evil.com"></noscript>';
      const result = sanitizeHtmlPermissive(input);
      // DOMPurify removes the noscript wrapper but may preserve safe inner content
      expect(result).not.toContain('<noscript');
      expect(result).not.toContain('</noscript>');
    });

    it('should remove template tags', () => {
      const input = '<template><script>alert(1)</script></template>';
      expect(sanitizeHtmlPermissive(input)).toBe('');
    });

    it('should remove event handlers', () => {
      const input = '<div onclick="alert(1)" onfocus="alert(2)">Content</div>';
      const result = sanitizeHtmlPermissive(input);
      expect(result).not.toContain('onclick');
      expect(result).not.toContain('onfocus');
    });
  });

  describe('Permissive Content Preservation', () => {
    it('should preserve SVG elements', () => {
      const input = '<svg width="100" height="100"><circle cx="50" cy="50" r="40"></circle></svg>';
      expect(sanitizeHtmlPermissive(input)).toContain('<svg');
      expect(sanitizeHtmlPermissive(input)).toContain('<circle');
    });

    it('should preserve syntax highlighting spans', () => {
      const input = '<span class="hljs-keyword">const</span> <span class="hljs-variable">x</span>';
      expect(sanitizeHtmlPermissive(input)).toBe(input);
    });

    it('should preserve custom data attributes', () => {
      const input = '<div data-value="123" data-type="item">Content</div>';
      expect(sanitizeHtmlPermissive(input)).toContain('data-value="123"');
      expect(sanitizeHtmlPermissive(input)).toContain('data-type="item"');
    });
  });

  describe('Edge Cases', () => {
    it('should return empty string for null-like input', () => {
      expect(sanitizeHtmlPermissive('')).toBe('');
      expect(sanitizeHtmlPermissive(null as unknown as string)).toBe('');
    });
  });
});

describe('escapeText', () => {
  describe('HTML Entity Escaping', () => {
    it('should escape < and >', () => {
      expect(escapeText('<script>')).toBe('&lt;script&gt;');
    });

    it('should escape &', () => {
      expect(escapeText('A & B')).toBe('A &amp; B');
    });

    it('should escape double quotes', () => {
      expect(escapeText('"quoted"')).toBe('&quot;quoted&quot;');
    });

    it('should escape single quotes', () => {
      expect(escapeText("it's")).toBe('it&#039;s');
    });

    it('should escape multiple special characters', () => {
      const input = '<a href="test">link</a>';
      const expected = '&lt;a href=&quot;test&quot;&gt;link&lt;/a&gt;';
      expect(escapeText(input)).toBe(expected);
    });
  });

  describe('Safe Content Preservation', () => {
    it('should not modify plain text', () => {
      expect(escapeText('Hello World')).toBe('Hello World');
    });

    it('should preserve numbers', () => {
      expect(escapeText('12345')).toBe('12345');
    });

    it('should preserve unicode characters', () => {
      expect(escapeText('Hello 世界')).toBe('Hello 世界');
    });

    it('should preserve emojis', () => {
      expect(escapeText('Hello 👋')).toBe('Hello 👋');
    });
  });

  describe('Edge Cases', () => {
    it('should return empty string for empty input', () => {
      expect(escapeText('')).toBe('');
    });

    it('should return empty string for null-like input', () => {
      expect(escapeText(null as unknown as string)).toBe('');
      expect(escapeText(undefined as unknown as string)).toBe('');
    });
  });
});

describe('safeHtml', () => {
  describe('Auto-escaping', () => {
    it('should escape interpolated strings', () => {
      const userInput = '<script>alert(1)</script>';
      const result = safeHtml`<div>${userInput}</div>`;
      expect(result).toBe('<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>');
    });

    it('should escape multiple interpolations', () => {
      const name = '<b>John</b>';
      const msg = '<script>xss</script>';
      const result = safeHtml`<p>From: ${name}</p><p>Message: ${msg}</p>`;
      expect(result).toContain('&lt;b&gt;John&lt;/b&gt;');
      expect(result).toContain('&lt;script&gt;xss&lt;/script&gt;');
    });

    it('should convert numbers to strings', () => {
      const count = 42;
      const result = safeHtml`<span>Count: ${count}</span>`;
      expect(result).toBe('<span>Count: 42</span>');
    });

    it('should handle null/undefined values', () => {
      const value = null as unknown as string;
      const result = safeHtml`<span>${value}test</span>`;
      expect(result).toBe('<span>test</span>');
    });
  });

  describe('SafeHtml Wrapper', () => {
    it('should not escape SafeHtml instances', () => {
      const safe = new SafeHtml('<strong>Bold</strong>');
      const result = safeHtml`<div>${safe}</div>`;
      expect(result).toBe('<div><strong>Bold</strong></div>');
    });

    it('should mix SafeHtml and regular strings', () => {
      const safe = new SafeHtml('<em>emphasis</em>');
      const unsafe = '<script>xss</script>';
      const result = safeHtml`<p>${safe} and ${unsafe}</p>`;
      expect(result).toBe('<p><em>emphasis</em> and &lt;script&gt;xss&lt;/script&gt;</p>');
    });
  });

  describe('Static Parts', () => {
    it('should preserve static HTML structure', () => {
      const name = 'John';
      const result = safeHtml`<div class="user"><span>${name}</span></div>`;
      expect(result).toBe('<div class="user"><span>John</span></div>');
    });
  });
});

describe('SafeHtml', () => {
  it('should store HTML string', () => {
    const safe = new SafeHtml('<b>test</b>');
    expect(safe.toString()).toBe('<b>test</b>');
  });

  it('should work with String coercion', () => {
    const safe = new SafeHtml('<em>italic</em>');
    expect(String(safe)).toBe('<em>italic</em>');
  });
});

describe('containsSuspiciousHtml', () => {
  describe('Detects Dangerous Patterns', () => {
    it('should detect script tags', () => {
      expect(containsSuspiciousHtml('<script>alert(1)</script>')).toBe(true);
      expect(containsSuspiciousHtml('<SCRIPT>alert(1)</SCRIPT>')).toBe(true);
    });

    it('should detect javascript: protocol', () => {
      expect(containsSuspiciousHtml('javascript:alert(1)')).toBe(true);
      expect(containsSuspiciousHtml('JAVASCRIPT:void(0)')).toBe(true);
    });

    it('should detect event handlers', () => {
      expect(containsSuspiciousHtml('onclick=alert(1)')).toBe(true);
      expect(containsSuspiciousHtml('onerror = alert(1)')).toBe(true);
      expect(containsSuspiciousHtml('onmouseover="alert(1)"')).toBe(true);
    });

    it('should detect iframe tags', () => {
      expect(containsSuspiciousHtml('<iframe src="evil.com">')).toBe(true);
    });

    it('should detect object tags', () => {
      expect(containsSuspiciousHtml('<object data="evil.swf">')).toBe(true);
    });

    it('should detect embed tags', () => {
      expect(containsSuspiciousHtml('<embed src="evil.swf">')).toBe(true);
    });

    it('should detect form tags', () => {
      expect(containsSuspiciousHtml('<form action="evil.com">')).toBe(true);
    });

    it('should detect data: URLs', () => {
      expect(containsSuspiciousHtml('data:text/html,<script>alert(1)</script>')).toBe(true);
    });
  });

  describe('Safe Content', () => {
    it('should return false for plain text', () => {
      expect(containsSuspiciousHtml('Hello World')).toBe(false);
    });

    it('should return false for safe HTML', () => {
      expect(containsSuspiciousHtml('<p>Paragraph</p>')).toBe(false);
    });

    it('should return false for empty input', () => {
      expect(containsSuspiciousHtml('')).toBe(false);
    });

    it('should return false for null-like input', () => {
      expect(containsSuspiciousHtml(null as unknown as string)).toBe(false);
      expect(containsSuspiciousHtml(undefined as unknown as string)).toBe(false);
    });
  });
});
