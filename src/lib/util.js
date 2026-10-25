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
 * Steam's default avatar host is unreachable on some networks, but Steam
 * serves the same assets on its Akamai edge, so every candidate URL is
 * expanded with a mirrored twin before the chain steps through them.
 */
function avatarCandidates(srcs) {
  const out = [];
  for (const raw of srcs) {
    if (!raw) continue;
    const u = raw.replace(/^http:\/\//i, 'https://');
    out.push(u);
    if (u.includes('avatars.steamstatic.com')) {
      out.push(u.replace('avatars.steamstatic.com', 'avatars.akamai.steamstatic.com'));
    }
  }
  return out;
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
  const list = avatarCandidates(srcs);
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

/**
 * A hero's 24px icon: the translated hero object supplies the image URL,
 * with a flat colour placeholder when the icon is missing or fails to load.
 * @param {{ icon?: string, color?: string }} hero - translated hero entry
 */
export function heroIcon(hero, className = 'hero-icon') {
  if (hero?.icon) {
    return h('img', {
      class: className,
      src: hero.icon,
      alt: '',
      width: '24',
      height: '24',
      loading: 'lazy',
      onError: (e) =>
        e.target.replaceWith(h('span', { class: `${className} hero-icon-ph`, style: `background:${hero.color}` })),
    });
  }
  return h('span', { class: `${className} hero-icon-ph`, style: `background:${hero?.color}` });
}

/** A small chip button that copies text and flashes feedback. */
export function copyChip(text, label) {
  return h('button', { class: 'chip-btn', type: 'button', onClick: copyChipClick(text) }, label);
}

/** Click handler factory behind copyChip: flash 'Copied' / 'Copy failed'. */
export function copyChipClick(text) {
  return async (event) => {
    const btn = event.currentTarget;
    const ok = await copyText(text);
    const original = btn.textContent;
    btn.textContent = ok ? 'Copied' : 'Copy failed';
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 1400);
  };
}

/** The ↗ external-link glyph as an inline SVG icon. */
export function iconExternal() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M6.5 3.5h-3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3M9.5 2.5h4v4M13 3 7.5 8.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}
