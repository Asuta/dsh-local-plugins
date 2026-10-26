/** Pure, testable local-path boundary. No process, shell, URL launch, or filesystem writes. */
export function parseLocalPath(input, cwd) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('invalid-path');
  let value = input.trim();
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('invalid-path');
  // Chat line anchors are navigation metadata, not part of an on-disk name.
  value = value.replace(/#L\d+(?:-L?\d+)?$/, '');
  if (/^file:/i.test(value)) {
    let url; try { url = new URL(value); } catch { throw new Error('invalid-path'); }
    if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost') || url.search || url.hash || url.username || url.password) throw new Error('non-local-path');
    try { value = decodeURIComponent(url.pathname); } catch { throw new Error('invalid-path'); }
    value = value.replace(/^\/(?=[A-Za-z]:[/\\])/, '');
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[/\\]/i.test(value)) {
    throw new Error('non-local-path');
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('invalid-path');
  // Do not contact UNC shares, extended devices, or scheme-relative web URLs.
  if (/^[/\\]{2}/.test(value) || /^\\[?.]\\/.test(value)) throw new Error('non-local-path');
  if (!/^[A-Za-z]:[/\\]/.test(value)) {
    if (value.startsWith('/') || !/^[A-Za-z]:[/\\]/.test(cwd ?? '')) throw new Error('unresolved-path');
    value = `${cwd.replace(/[/\\]+$/, '')}\\${value}`;
  }
  value = value.replace(/\//g, '\\');
  const drive = value.slice(0, 2);
  const segments = [];
  for (const segment of value.slice(3).split('\\')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { if (!segments.length) throw new Error('invalid-path'); segments.pop(); continue; }
    if (/[<>:"|?*]/.test(segment) || /[. ]$/.test(segment) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(segment)) throw new Error('invalid-path');
    segments.push(segment);
  }
  return `${drive}\\${segments.join('\\')}`;
}

export function createNativeOpener({ remote, cwd, available, inspectPath, notify }) {
  return async function openLocalPath(input) {
    try {
      const path = parseLocalPath(input, typeof cwd === 'function' ? cwd() : cwd);
      const capability = typeof available === 'function' ? await available() : available;
      if (!capability || typeof remote?.openWorkspacePath !== 'function') throw new Error('native-unavailable');
      const info = await inspectPath(path);
      if (!info || !['file', 'directory'].includes(info.type)) throw new Error('path-not-found');
      // Directories open normally; files select in Explorer. Never default-open a file.
      const result = await remote.openWorkspacePath({ path: info.path, ...(info.type === 'file' ? { action: 'reveal' } : {}) });
      if (result?.opened !== true) throw new Error('native-open-failed');
    } catch (error) {
      notify?.(error);
      throw error;
    }
  };
}
