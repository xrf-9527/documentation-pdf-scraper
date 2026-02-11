import { PandocPdfService } from '../src/services/pandocPdfService.js';
import path from 'path';
import fs from 'fs';

const INPUT_FILE = './pdfs/markdown/001-sub-agents.md';
const OUTPUT_DIR = './reproduce_output';
const OUTPUT_FILE = path.join(OUTPUT_DIR, '001-sub-agents.pdf');

async function verify() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Input file not found: ${INPUT_FILE}`);
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const service = new PandocPdfService({
    config: {
      markdownPdf: {
        highlightStyle: 'github',
        pdfOptions: {
          format: 'A4',
          margin: '20mm',
        },
      },
    },
    logger: {
      info: console.log,
      error: console.error,
      warn: console.warn,
    },
  });

  console.log(`Converting ${INPUT_FILE} to ${OUTPUT_FILE}...`);
  try {
    await service.convertToPdf(INPUT_FILE, OUTPUT_FILE);
    console.log(`✅ PDF generated successfully at ${OUTPUT_FILE}`);
  } catch (err) {
    console.error('❌ Failed to generate PDF:', err);
    process.exit(1);
  }
}

verify().catch(console.error);
