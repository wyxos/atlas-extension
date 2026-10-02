const phases = {
  collecting: ['Collecting gallery', 'Gallery items are collected and sent to Desktop in batches.'],
  queueing: ['Queueing gallery', 'Sending collected items to Desktop.'],
  restoring: ['Returning to starting image', 'Finishing the gallery operation.'],
  paused: ['Collection paused', 'Queued items stay in Desktop. Retry to continue.'],
  cancelled: ['Collection cancelled', 'Queued items stay in Desktop.'],
  completed: ['Gallery queued', 'All collected items were sent to Desktop.'],
};

export function createCollectionProgress(parent, {
  documentContext = parent.ownerDocument ?? globalThis.document,
  onCancel,
  onDismiss,
  onRetry,
} = {}) {
  const panel = element('section', 'atlas-collection-progress');
  panel.hidden = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Gallery collection');

  const status = element('div', 'atlas-collection-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  const heading = element('h2', 'atlas-collection-heading');
  const counts = element('p', 'atlas-collection-counts');
  status.append(heading, counts);

  const progress = element('div', 'atlas-collection-bar');
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', 'Gallery collection progress');
  const fill = element('div', 'atlas-collection-bar-fill');
  fill.setAttribute('aria-hidden', 'true');
  progress.append(fill);

  const note = element('p', 'atlas-collection-note');
  const actions = element('div', 'atlas-collection-actions');
  const cancel = button('Cancel', 'Cancel gallery collection', onCancel);
  const retry = button('Retry', 'Retry gallery collection', onRetry);
  const close = button('Close', 'Close gallery collection progress', () => {
    clear();
    onDismiss?.();
  });
  retry.className += ' atlas-collection-action-primary';
  actions.append(cancel, retry, close);
  panel.append(status, progress, note, actions);
  parent.append(panel);

  function element(tagName, className) {
    const node = documentContext.createElement(tagName);
    node.className = className;
    return node;
  }

  function button(label, accessibleLabel, action) {
    const node = element('button', 'atlas-collection-action');
    node.type = 'button';
    node.textContent = label;
    node.setAttribute('aria-label', accessibleLabel);
    node.addEventListener('click', () => {
      if (!node.disabled && !node.hidden) action?.();
    });
    return node;
  }

  function show(input) {
    const phase = Object.hasOwn(phases, input?.phase) ? input.phase : 'collecting';
    const collected = normalizeCount(input?.collected);
    const queued = normalizeCount(input?.queued);
    const total = Number.isSafeInteger(input?.total) && input.total > 0
      ? Math.max(input.total, collected, queued)
      : null;
    const active = phase === 'collecting' || phase === 'queueing';
    const retryable = phase === 'paused' || phase === 'cancelled';
    const current = phase === 'collecting' ? collected : queued;
    const summary = `Collected ${collected}${total === null ? '' : ` of ${total}`} · Queued ${queued}`;

    panel.hidden = false;
    panel.setAttribute('data-phase', phase);
    heading.textContent = phases[phase][0];
    counts.textContent = summary;
    note.textContent = phases[phase][1];
    progress.setAttribute('aria-valuetext', `${summary}${total === null ? '; gallery size unknown' : ''}`);
    if (total === null) {
      progress.removeAttribute('aria-valuemin');
      progress.removeAttribute('aria-valuemax');
      progress.removeAttribute('aria-valuenow');
      progress.setAttribute('data-indeterminate', 'true');
      fill.style.width = '33%';
    } else {
      progress.setAttribute('aria-valuemin', '0');
      progress.setAttribute('aria-valuemax', String(total));
      progress.setAttribute('aria-valuenow', String(Math.min(current, total)));
      progress.removeAttribute('data-indeterminate');
      fill.style.width = `${Math.min(100, (current / total) * 100)}%`;
    }
    cancel.hidden = !active;
    cancel.disabled = typeof onCancel !== 'function';
    retry.hidden = !(retryable && input?.canRetry === true);
    retry.disabled = typeof onRetry !== 'function';
    close.hidden = active || phase === 'restoring';
  }

  function clear() {
    panel.hidden = true;
  }

  return { show, clear };
}

function normalizeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
