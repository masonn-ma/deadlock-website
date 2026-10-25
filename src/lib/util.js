/** Tiny DOM + misc helpers shared by the views. */

/**
 * Create an element.
 * @param {string} tag
 * @param {Record<string, any>} [attrs] - `class`, `dataset`, `on*` handlers, or plain attributes.
 * @param {...(Node|string|null|undefined|Array)} children - strings become text nodes (safe).
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      // 'onClick' -> 'click' (event types are case-sensitive)
      el.addEventListener(key.slice(2).toLowerCase(), value);
    }
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

/** Escape a string for use inside innerHTML templates. */
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Copy text to the clipboard, resolving once the promise settles. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Debounce helper for the search input. */
export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * An avatar that steps through Steam's avatar sizes and, if every URL fails,
 * degrades to an initial-letter placeholder — a broken-image icon never ships.
 * @param {Array<string>} srcs - ordered candidates, best first
 * @param {string} className - carries the sizing/border-radius rules
 * @param {string} initial - person name for the fallback letter
 * @param {string} [alt]
 */
export function avatarImg(srcs, className, initial, alt = '') {
  const list = srcs.filter(Boolean);
  const placeholder = () =>
    h('span', { class: `${className} avatar-ph` }, (initial || '?').trim().charAt(0).toUpperCase() || '?');
  if (!list.length) return placeholder();
  const img = h('img', { class: className, alt });
  let i = 0;
  img.addEventListener('error', () => {
    i += 1;
    if (i < list.length) img.src = list[i];
    else img.replaceWith(placeholder());
  });
  img.src = list[0];
  return img;
}
