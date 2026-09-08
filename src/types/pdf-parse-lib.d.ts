// pdf-parse's package index runs a debug routine (reads a bundled test PDF) when it is not loaded as a
// CommonJS parent, which is how Next loads it. We import the library entry directly; this types it.
declare module "pdf-parse/lib/pdf-parse.js" {
  const pdfParse: (buffer: Buffer, options?: { max?: number }) => Promise<{ text: string; numpages: number; info?: unknown }>;
  export default pdfParse;
}
