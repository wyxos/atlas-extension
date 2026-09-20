export function samePage(left, right) {
  try { const a = new URL(left); const b = new URL(right); return ['http:', 'https:'].includes(a.protocol) && !a.username && !a.password && !a.port && a.origin === b.origin && a.pathname === b.pathname; }
  catch { return false; }
}
