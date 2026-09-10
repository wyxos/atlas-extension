const codes = { blue: 36, green: 32, yellow: 33, red: 31, dim: 90 };

export function createTerminal({ stream = process.stdout, env = process.env, log,
  now = Date.now } = {}) {
  const interactive = !log && Boolean(stream.isTTY) && env.TERM !== 'dumb';
  const colored = interactive && !Object.hasOwn(env, 'NO_COLOR');
  let active;
  let group;
  const paint = (text, color) => colored ? `\x1b[${codes[color]}m${text}\x1b[0m` : text;
  const clear = () => { if (interactive) stream.write('\r\x1b[2K'); };
  const line = (text = '', color) => {
    clear();
    if (log) log(text);
    else stream.write(`${color ? paint(text, color) : text}\n`);
  };
  const elapsed = () => {
    const seconds = Math.round((now() - active.started) / 1000);
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };
  const render = () => {
    if (!interactive || !active) return;
    const { index, total, title, detail } = active;
    const bar = '='.repeat(Math.floor(index / total * 12)).padEnd(12, '-');
    const text = `> ${title} | ${elapsed()} | [${bar}] ${index}/${total} done, ${total - index} left${detail ? ` | ${detail}` : ''}`;
    // Keep the live line within one terminal row, including after a resize.
    const width = Math.max(1, (stream.columns || 100) - 1);
    clear();
    stream.write(paint(text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text, 'blue'));
  };
  return {
    paint, line,
    start(title, index, total) {
      const separator = title.indexOf(': ');
      const nextGroup = separator < 0 ? 'Build' : title.slice(0, separator);
      if (nextGroup !== group) { line(); line(nextGroup.toUpperCase(), 'blue'); group = nextGroup; }
      active = { title: separator < 0 ? title : title.slice(separator + 2), index, total, started: now() };
      if (interactive) render();
      else line(`[${index + 1}/${total}] ${title}`);
    },
    status(detail) { if (active) { active.detail = detail; render(); } },
    tick: render,
    done() { line(`  OK  ${active.title} (${elapsed()})`, 'green'); active = undefined; },
    fail() { if (active) line(`  FAILED  ${active.title} (${elapsed()})`, 'red'); active = undefined; },
  };
}

export const terminal = createTerminal();
