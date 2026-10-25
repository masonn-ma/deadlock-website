/**
 * Settings: the optional Steam Web API key used for exact vanity-URL
 * resolution. Stored only in this browser's localStorage - it is the
 * visitor's own free key and never leaves their machine except to call
 * Steam's API directly.
 */

const KEY_STORAGE = 'sl_steam_key';

export function getSteamKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

function setSteamKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
    return true;
  } catch {
    return false;
  }
}

/** Wire up the settings <dialog> present in index.html. */
export function initSettings() {
  const dialog = document.getElementById('settings-dialog');
  const openBtn = document.getElementById('settings-btn');
  const form = dialog?.querySelector('form');
  const input = dialog?.querySelector('#steam-key-input');
  const status = dialog?.querySelector('#steam-key-status');
  const clearBtn = dialog?.querySelector('#steam-key-clear');
  const cancelBtn = dialog?.querySelector('#settings-cancel');
  if (!dialog || !form || !input) return;

  openBtn?.addEventListener('click', () => {
    input.value = getSteamKey();
    setStatus(getSteamKey() ? 'Key saved in this browser.' : '');
    dialog.showModal();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (setSteamKey(value)) {
      setStatus(value ? 'Key saved in this browser.' : 'Key removed.');
    } else {
      setStatus('Couldn\u2019t save in this browser (storage blocked).');
    }
    dialog.close();
  });

  cancelBtn?.addEventListener('click', () => {
    input.value = getSteamKey();
    setStatus(getSteamKey() ? 'Key saved in this browser.' : '');
    dialog.close();
  });

  clearBtn?.addEventListener('click', () => {
    input.value = '';
    setSteamKey('');
    setStatus('Key removed.');
  });

  function setStatus(message) {
    if (status) status.textContent = message;
  }
}
