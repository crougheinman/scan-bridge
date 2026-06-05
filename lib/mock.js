// Mock scanner: produces a sample 2-page PDF so the full pipeline (claim ->
// upload -> order) can be tested before a real scanner is wired in.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function scan(job) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const settings = job?.settings || {};

  const pages = [
    { title: 'INVOICE (mock)', lines: ['This is a placeholder scan, not a real document.', 'Customer: Jane Doe', 'Total: $1,299.00'] },
    { title: 'DELIVERY SERVICE FORM (mock)', lines: ['Address: 123 Main St, Mesa AZ', 'Requested: Fri or Sat ONLY', 'Setup: yes   Removal: yes'] },
  ];

  for (const p of pages) {
    const page = doc.addPage([612, 792]); // Letter @ 72dpi
    page.drawText(p.title, { x: 50, y: 720, size: 20, font: bold, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(`Job #${job?.id ?? '?'}  ·  bridge MOCK mode`, { x: 50, y: 695, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
    let y = 660;
    for (const line of p.lines) { page.drawText(line, { x: 50, y, size: 12, font }); y -= 22; }
    page.drawText(
      `settings: ${JSON.stringify(settings)}`,
      { x: 50, y: 80, size: 8, font, color: rgb(0.5, 0.5, 0.5) },
    );
  }

  const bytes = await doc.save();
  return { bytes, pageCount: doc.getPageCount() };
}
