import { PDFDocument } from 'pdf-lib';
import { PdfService } from './pdf.service';

describe('PdfService', () => {
  const pdf = new PdfService();

  it('renders a valid multi-page PDF with accents and unsupported characters', async () => {
    const body = Array.from({ length: 120 }, (_, i) => `Riga ${i} città perché è così – “virgolette” e 日本 emoji 😀`).join('\n');
    const buf = await pdf.render({ title: 'Titolo di prova àèìòù', body, footer: ['Piè di pagina'], meta: 'meta' });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
