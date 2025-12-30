/**
 * HTML Sanitization Utilities
 *
 * Provides centralized XSS protection for innerHTML usage across the frontend.
 * Uses DOMPurify for untrusted HTML and escaping for plain text.
 *
 * ## Usage Guidelines
 *
 * ### When to use each function:
 *
 * | Function               | Use Case                                          |
 * |------------------------|---------------------------------------------------|
 * | `escapeText()`         | User input that should display as plain text      |
 * | `sanitizeHtml()`       | Markdown/rich text that needs HTML formatting     |
 * | `sanitizeHtmlPermissive()` | Trusted HTML like syntax-highlighted code    |
 * | `safeHtml``            | Template literals with embedded user data         |
 *
 * ### Examples:
 *
 * ```typescript
 * // Plain text - user names, file paths, etc.
 * element.innerHTML = `<span>${escapeText(username)}</span>`;
 *
 * // Rich text from API - comments, descriptions
 * element.innerHTML = sanitizeHtml(markdownToHtml(comment));
 *
 * // Syntax-highlighted code (trusted source)
 * element.innerHTML = sanitizeHtmlPermissive(highlightCode(source));
 *
 * // Template with mixed content
 * element.innerHTML = safeHtml`<div class="item">${title}</div>`;
 * ```
 *
 * ### Security Rules:
 *
 * 1. NEVER use innerHTML with raw template literals containing user data
 * 2. ALWAYS escape/sanitize before innerHTML assignment
 * 3. Prefer textContent for plain text (no HTML needed)
 * 4. Run `npm run lint:security` to check for violations
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html
 */

import DOMPurify from 'dompurify';

/**
 * Sanitize untrusted HTML content.
 * Use this when rendering HTML that may contain user-supplied or API-returned content.
 * DOMPurify removes dangerous elements/attributes while preserving safe HTML structure.
 *
 * @param html - The HTML string to sanitize
 * @returns Sanitized HTML safe for innerHTML
 *
 * @example
 * element.innerHTML = sanitizeHtml(userProvidedMarkdown);
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    // Allow common formatting tags
    ALLOWED_TAGS: [
      'a', 'b', 'i', 'em', 'strong', 'u', 's', 'del', 'ins',
      'p', 'br', 'hr',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li',
      'blockquote', 'pre', 'code',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'div', 'span',
      'img',
      'sub', 'sup',
    ],
    // Allow safe attributes
    ALLOWED_ATTR: [
      'href', 'target', 'rel', 'title', 'alt', 'src',
      'class', 'id',
      'colspan', 'rowspan',
    ],
    // Allow target and rel attributes on links (note: ADD_ATTR only adds to allowed list,
    // it does not automatically set these values on elements)
    ADD_ATTR: ['target', 'rel'],
    // Remove dangerous event handler attributes
    FORBID_ATTR: ['onclick', 'onerror', 'onload', 'onmouseover'],
  });
}

/**
 * Sanitize HTML with minimal restrictions.
 * Use this for trusted sources where you need more HTML elements (like code highlighting).
 * Still removes script tags and event handlers for safety.
 *
 * @param html - The HTML string to sanitize
 * @returns Sanitized HTML
 *
 * @example
 * codeContainer.innerHTML = sanitizeHtmlPermissive(highlightedCode);
 */
export function sanitizeHtmlPermissive(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    // Allow most tags but remove dangerous ones that could execute code or affect page structure
    FORBID_TAGS: [
      'script', 'style', 'iframe', 'object', 'embed', 'form',
      'base', 'meta', 'link', 'noscript', 'template',
    ],
    // Remove all event handlers
    FORBID_ATTR: ['onclick', 'onerror', 'onload', 'onmouseover', 'onfocus', 'onblur'],
  });
}

/**
 * Escape plain text to prevent HTML injection.
 * Use this when inserting plain text that should NOT be interpreted as HTML.
 * Faster than DOMPurify for simple text escaping.
 *
 * @param text - The plain text to escape
 * @returns Escaped text safe for innerHTML
 *
 * @example
 * element.innerHTML = `<span>${escapeText(username)}</span>`;
 */
export function escapeText(text: string): string {
  if (!text) return '';
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => escapeMap[char]);
}

/**
 * Tagged template literal for building HTML safely.
 * Automatically escapes interpolated values as plain text.
 * Use for constructing HTML with embedded user data.
 *
 * @example
 * element.innerHTML = safeHtml`<div class="user">${username}</div>`;
 *
 * // For already-safe HTML, use SafeHtml wrapper:
 * element.innerHTML = safeHtml`<div>${new SafeHtml(alreadySafeContent)}</div>`;
 */
export function safeHtml(
  strings: TemplateStringsArray,
  ...values: (string | number | SafeHtml)[]
): string {
  return strings.reduce((result, str, i) => {
    const value = values[i - 1];
    if (value === undefined || value === null) {
      return result + str;
    }
    if (value instanceof SafeHtml) {
      return result + value.toString() + str;
    }
    return result + escapeText(String(value)) + str;
  }, '');
}

/**
 * Wrapper class to mark HTML as already sanitized/safe.
 * Use with safeHtml template literal to inject pre-sanitized content.
 *
 * @example
 * const highlighted = sanitizeHtmlPermissive(highlightCode(code));
 * element.innerHTML = safeHtml`<pre>${new SafeHtml(highlighted)}</pre>`;
 */
export class SafeHtml {
  private readonly html: string;

  constructor(html: string) {
    this.html = html;
  }

  toString(): string {
    return this.html;
  }
}

/**
 * Check if a string contains potentially dangerous HTML.
 * Useful for validation and logging.
 *
 * @param html - The string to check
 * @returns true if the string contains suspicious patterns
 */
export function containsSuspiciousHtml(html: string): boolean {
  if (!html) return false;

  const suspiciousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i, // Event handlers like onclick=
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /<form/i,
    /data:/i, // data: URLs can be dangerous
  ];

  return suspiciousPatterns.some((pattern) => pattern.test(html));
}

// Re-export DOMPurify for advanced use cases
export { DOMPurify };
