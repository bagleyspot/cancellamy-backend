/**
 * Plain-text version of an HTML email body, used only for matching and classification. The result is stored and
 * shown as text, never rendered as HTML.
 *
 * A single-pass scanner instead of chained regex replacements: replacements can re-create the markup they remove
 * (for example "<scr<b>ipt>"), a scanner cannot.
 */
export function htmlToText(html: string): string {
  const lower = html.toLowerCase();
  let out = '';
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf('<', i);
    if (open === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, open);
    const close = html.indexOf('>', open + 1);
    if (close === -1) break; // unterminated tag: drop the remainder
    const tag = lower.slice(open + 1, close);
    const closing = tag.startsWith('/');
    const name = /^\/?([a-z][a-z0-9]*)/.exec(tag)?.[1];
    i = close + 1;
    if ((name === 'script' || name === 'style') && !closing) {
      const end = lower.indexOf(`</${name}`, i);
      if (end === -1) break;
      const endClose = html.indexOf('>', end);
      i = endClose === -1 ? html.length : endClose + 1;
    } else if (name === 'br') {
      out += '\n';
    } else if (name === 'p' && closing) {
      out += '\n\n';
    }
  }
  // "&lt;" and "&gt;" stay encoded on purpose (decoding them would re-create markup-looking text), and "&amp;" is
  // decoded last so "&amp;lt;" becomes "&lt;", not "<".
  return out
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}
