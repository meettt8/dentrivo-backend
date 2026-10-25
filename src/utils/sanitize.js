/**
 * Lightweight and robust HTML sanitizer to prevent Stored XSS in CMS content.
 */

const ALLOWED_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike',
  'ul', 'ol', 'li', 'a', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'div', 'span', 'code', 'pre',
]);

const ALLOWED_ATTRIBUTES = new Set([
  'href', 'target', 'rel', 'class', 'title',
]);

/**
 * Sanitize an HTML string by removing dangerous tags, attributes, and protocol schemes.
 */
export function sanitizeHtml(rawHtml = '') {
  if (!rawHtml || typeof rawHtml !== 'string') return '';

  let html = rawHtml;

  // 1. Remove dangerous script, iframe, object, embed, form, input, base tags and their contents
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  html = html.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  html = html.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  html = html.replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '');

  // 2. Remove all event handlers (e.g. onload, onclick, onerror)
  html = html.replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '');
  html = html.replace(/\son\w+\s*=\s*[^>\s]+/gi, '');

  // 3. Remove dangerous protocols (javascript:, vbscript:, data:text/html)
  html = html.replace(/href\s*=\s*(['"])\s*(?:javascript|vbscript|data):.*?\1/gi, 'href="#"');

  // 4. Clean tag attributes to only allow permitted attributes
  html = html.replace(/<(\/?[a-z0-9]+)([^>]*)>/gi, (match, tagName, attrs) => {
    const lowerTag = tagName.toLowerCase().replace('/', '');
    const isClosing = tagName.startsWith('/');

    if (!ALLOWED_TAGS.has(lowerTag)) {
      // Disallowed tag: return empty or text
      return '';
    }

    if (isClosing) {
      return `</${lowerTag}>`;
    }

    // Filter attributes
    const cleanAttrs = [];
    const attrRegex = /([a-z0-9_-]+)(?:\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\s>]+)))?/gi;
    let attrMatch;

    while ((attrMatch = attrRegex.exec(attrs)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      const attrVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';

      if (ALLOWED_ATTRIBUTES.has(attrName)) {
        if (attrName === 'href') {
          // Extra safety check for href
          if (/^(?:https?:|\/|#|mailto:|tel:)/i.test(attrVal.trim())) {
            cleanAttrs.push(`href="${attrVal.replace(/"/g, '&quot;')}"`);
          }
        } else if (attrName === 'target' && attrVal === '_blank') {
          cleanAttrs.push('target="_blank" rel="noopener noreferrer"');
        } else if (attrName !== 'target' && attrName !== 'rel') {
          cleanAttrs.push(`${attrName}="${attrVal.replace(/"/g, '&quot;')}"`);
        }
      }
    }

    const attrsString = cleanAttrs.length > 0 ? ` ${cleanAttrs.join(' ')}` : '';
    return `<${lowerTag}${attrsString}>`;
  });

  return html;
}

export default sanitizeHtml;
