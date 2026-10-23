const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Minimal, dependency-free responsive HTML email. */
export function renderHtml(title: string, paragraphs: string[], button?: { label: string; url: string }): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 14px;line-height:1.55;color:#1f2937">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const btn = button
    ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#0f766e;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">${esc(button.label)}</a></p><p style="font-size:12px;color:#6b7280;word-break:break-all">${esc(button.url)}</p>`
    : '';
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="margin:0;background:#f5f3ee;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px"><p style="margin:0 0 18px;font-size:20px;font-weight:700;color:#0f766e">Cancellamy</p><h1 style="margin:0 0 16px;font-size:18px;color:#111827">${esc(title)}</h1>${body}${btn}</div><p style="text-align:center;font-size:12px;color:#9ca3af;margin-top:16px">Software libero (AGPL-3.0)</p></body></html>`;
}
