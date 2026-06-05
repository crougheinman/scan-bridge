// Assembles scanned pages (JPEG/PNG/PDF buffers) into a single PDF.
import { PDFDocument } from 'pdf-lib';

/**
 * @param {Array<{type: string, buf: Buffer|Uint8Array}>} pages
 * @returns {Promise<{bytes: Uint8Array, pageCount: number}>}
 */
export async function assemblePdf(pages) {
  const out = await PDFDocument.create();

  for (const page of pages) {
    const type = (page.type || '').toLowerCase();
    const data = page.buf instanceof Uint8Array ? page.buf : new Uint8Array(page.buf);

    if (type.includes('pdf')) {
      // Already a PDF (single or multi-page): copy all its pages in order.
      const src = await PDFDocument.load(data, { ignoreEncryption: true });
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach((p) => out.addPage(p));
      continue;
    }

    let image;
    if (type.includes('png')) {
      image = await out.embedPng(data);
    } else {
      // default: treat as JPEG (eSCL image/jpeg is the universal output)
      image = await out.embedJpg(data);
    }
    const p = out.addPage([image.width, image.height]);
    p.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }

  const bytes = await out.save();
  return { bytes, pageCount: out.getPageCount() };
}
