// Renders the Desktop mock state as a page so videos and screenshots can
// show exactly what Atlas Extension sent and what the mock downloaded.
export function renderMockLog(state) {
  const files = state.files.map(file => {
    const preview = file.stored && file.stored.content_type.startsWith('image/')
      ? `<img src="/__mock/files/${file.id}" alt="">`
      : `<div class="noimg">${escape(file.stored?.content_type ?? 'not downloaded')}</div>`;
    const rows = [
      ['asset_url', file.url], ['referrer_url', file.referrer_url], ['source', file.source], ['reaction', file.reaction],
      ['download', `${file.download?.status ?? '—'} ${file.download?.progress_percent ?? ''}%`],
      ['stored file', file.stored ? `${file.filename}${file.stored.path.slice(file.stored.path.lastIndexOf('.'))} · ${file.stored.bytes} bytes · ${file.stored.content_type}` : '—'],
      ...Object.entries(file.received_metadata ?? {}).map(([key, value]) => [`metadata.${key}`, value]),
      ['Desktop persists today', JSON.stringify(file.listing_metadata)],
    ].map(([key, value]) => `<tr><th>${escape(key)}</th><td>${escape(value ?? '—')}</td></tr>`).join('');
    return `<article data-file-id="${file.id}"><div class="preview">${preview}</div><table>${rows}</table></article>`;
  }).join('') || '<p class="empty">No items captured yet.</p>';
  const requests = state.requests.map(entry =>
    `<li><code>${escape(entry.method)} ${escape(entry.path)}</code> <span>${escape(entry.at.slice(11, 23))}</span></li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Atlas Desktop mock · captured items</title><style>
    body{margin:0;padding:24px;background:#00040a;color:#d0d7e5;font:14px/1.5 system-ui,sans-serif}
    h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px;color:#9ba3b5}
    p.sub{margin:0 0 16px;color:#9ba3b5}
    article{display:flex;gap:16px;background:#000b1f;border:1px solid #33415c;border-radius:4px;padding:12px;margin-bottom:12px}
    .preview img{width:180px;border-radius:4px;display:block}.noimg{width:180px;height:100px;display:grid;place-items:center;background:#1e2737;border-radius:4px;color:#9ba3b5}
    table{border-collapse:collapse;font-size:12px}th{text-align:left;color:#9ba3b5;font-weight:500;padding:2px 12px 2px 0;white-space:nowrap;vertical-align:top}
    td{padding:2px 0;word-break:break-all;color:#fff}ul{margin:0;padding-left:18px;font-size:12px;columns:2}code{color:#0f85fa}
  </style></head><body><h1>Atlas Desktop mock · captured items</h1>
  <p class="sub">Runtime ${escape(state.runtimeId)} · requests the extension sent to the Desktop API and the files the mock downloaded.</p>
  ${files}<h2>Request log</h2><ul>${requests}</ul></body></html>`;
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
