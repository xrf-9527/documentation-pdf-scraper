import { PandocPdfService } from '../src/services/pandocPdfService.js';
import path from 'path';
import fs from 'fs';

const OUTPUT_DIR = './reproduce_output';
const LONG_JSON = JSON.stringify(
  {
    'code-reviewer': {
      description: 'Expert code reviewer. Use proactively after code changes.',
      prompt:
        'You are a senior code reviewer. Focus on code quality, security, and best practices. Provide detailed feedback on readability, maintainability, and performance.',
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
      model: 'sonnet',
    },
    'very-long-key-to-force-wrapping-behavior-in-the-output-pdf-which-is-currently-failing':
      'some very long value that should also wrap if the system is working correctly according to the user requirements and industry best practices.',
  },
  null,
  2
);

const MARKDOWN_CONTENT = `
# Reproduction Test

Here is a long JSON block that should wrap:

\`\`\`json
${LONG_JSON}
\`\`\`

Here is a broken code block from the user issue:

\`\`\`markdown theme={null}
---
name: test-agent
---
Some content
\`\`\`

End of test.
`;

async function reproduce() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const outputPath = path.join(OUTPUT_DIR, 'reproduce_issue.pdf');
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

  console.log('Generating PDF...');
  try {
    await service.convertContentToPdf(MARKDOWN_CONTENT, outputPath);
    console.log(`PDF generated at ${outputPath}`);
  } catch (err) {
    console.error('Failed to generate PDF:', err);
  }
}

reproduce().catch(console.error);
