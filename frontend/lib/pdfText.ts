// Extract plain text from a PDF entirely in the browser (pdfjs-dist). Loaded
// dynamically so the ~1MB library only ships when someone actually opens a PDF.
// Capped so a huge textbook doesn't overwhelm the import parser downstream.
export async function extractPdfText(file: File, maxChars = 18000): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Bundle the worker via a module URL — no external CDN, so the CSP stays happy.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items.map((it) => ("str" in it ? (it as { str: string }).str : "")).join(" ");
    out += line + "\n";
    if (out.length >= maxChars) break;
  }
  return out.slice(0, maxChars).replace(/[ \t]+/g, " ").trim();
}
