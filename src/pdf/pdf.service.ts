import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;

function normalise(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\u00A0/g, ' ');
}

@Injectable()
export class PdfService {
  /** Renders a plain document (title + paragraphs + optional footer lines) to an A4 PDF. */
  async render(opts: { title: string; body: string; footer?: string[]; meta?: string }): Promise<Buffer> {
    const doc = await PDFDocument.create();
    doc.setTitle(opts.title);
    doc.setProducer('Cancellamy');
    doc.setCreator('Cancellamy');
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const allowed = new Set(font.getCharacterSet());
    const clean = (s: string) =>
      [...normalise(s)].map((ch) => (allowed.has(ch.codePointAt(0) as number) ? ch : '?')).join('');

    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;
    const maxWidth = PAGE_W - MARGIN * 2;

    const newPage = () => {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    };
    const drawLine = (text: string, f: PDFFont, size: number, color = rgb(0.1, 0.1, 0.1)) => {
      const lineHeight = size * 1.35;
      if (y - lineHeight < MARGIN) newPage();
      page.drawText(text, { x: MARGIN, y: y - size, size, font: f, color });
      y -= lineHeight;
    };
    const wrap = (text: string, f: PDFFont, size: number): string[] => {
      const lines: string[] = [];
      let current = '';
      for (const word of text.split(/\s+/)) {
        if (!word) continue;
        const candidate = current ? `${current} ${word}` : word;
        if (f.widthOfTextAtSize(candidate, size) <= maxWidth) {
          current = candidate;
        } else {
          if (current) lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
      return lines.length ? lines : [''];
    };

    wrap(clean(opts.title), bold, 14).forEach((l) => drawLine(l, bold, 14));
    y -= 6;
    if (opts.meta) {
      wrap(clean(opts.meta), font, 9).forEach((l) => drawLine(l, font, 9, rgb(0.4, 0.4, 0.4)));
      y -= 6;
    }
    for (const para of opts.body.split('\n')) {
      if (!para.trim()) {
        y -= 7;
        continue;
      }
      wrap(clean(para), font, 10.5).forEach((l) => drawLine(l, font, 10.5));
    }
    if (opts.footer?.length) {
      y -= 12;
      for (const f of opts.footer) wrap(clean(f), font, 8.5).forEach((l) => drawLine(l, font, 8.5, rgb(0.35, 0.35, 0.35)));
    }
    return Buffer.from(await doc.save());
  }
}
