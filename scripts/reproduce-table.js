import { PandocPdfService } from '../src/services/pandocPdfService.js';
import path from 'path';
import fs from 'fs';

const OUTPUT_DIR = './reproduce_output';
const TABLE_MARKDOWN = `
# Table Reproduction (Normalized)

| Field            | Required | Description                                      |
| :--------------- | :------- | :----------------------------------------------- |
| \`name\`           | Yes      | Unique identifier using lowercase letters and hyphens                                                                                                                                                           |
| \`description\`    | Yes      | Natural language description of the subagent's purpose                                                                                                                                                          |
| \`tools\`          | No       | Comma-separated list of specific tools. If omitted, inherits all tools from the main thread                                                                                                                     |
| \`model\`          | No       | Model to use for this subagent. Can be a model alias (\`sonnet\`, \`opus\`, \`haiku\`) or \`'inherit'\` to use the main conversation's model. If omitted, defaults to the [configured subagent model](/en/model-config) |
| \`permissionMode\` | No       | Permission mode for the subagent. Valid values: \`default\`, \`acceptEdits\`, \`bypassPermissions\`, \`plan\`, \`ignore\`. Controls how the subagent handles permission requests                                          |
| \`skills\`         | No       | Comma-separated list of skill names to auto-load when the subagent starts. Skills are loaded into the subagent's context automatically                                                                          |
`;

async function reproduce() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const outputPath = path.join(OUTPUT_DIR, 'reproduce_table.pdf');
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
    await service.convertContentToPdf(TABLE_MARKDOWN, outputPath);
    console.log(`PDF generated at ${outputPath}`);
  } catch (err) {
    console.error('Failed to generate PDF:', err);
  }
}

reproduce().catch(console.error);
