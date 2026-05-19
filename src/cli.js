#!/usr/bin/env node

import { Command } from "commander";
import { createRequire } from "node:module";
import { renderMarkdownToPdf } from "./index.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const program = new Command();

program
  .name("md-mermaid-pdf")
  .description("Render GitHub-flavoured Markdown with Mermaid diagrams to PDF.")
  .version(version, "-v, --version")
  .argument("<input>", "Markdown file to render")
  .argument("[output]", "PDF output path. Defaults to the input filename with .pdf")
  .option("--title <title>", "Document title. Defaults to the Markdown file basename")
  .option("--author <author>", "PDF author metadata", "md-mermaid-pdf")
  .option("--theme <theme>", "Mermaid theme", "default")
  .option("--page-size <size>", "PDF page size", "A4")
  .option("--margin <margin>", "PDF margin, e.g. 15mm, 0.5in", "18mm")
  .option("--toc", "Inject a table of contents generated from Markdown headings", false)
  .option("--no-background", "Do not print CSS backgrounds")
  .option("--debug-html <path>", "Write the intermediate HTML to this path")
  .option("--verbose", "Print timing for each phase", false)
  .option("--quiet", "Suppress all output", false)
  .parse();

const opts = program.opts();
const [inputArg, outputArg] = program.args;

async function main() {
  const result = await renderMarkdownToPdf(inputArg, outputArg, {
    title: opts.title,
    author: opts.author,
    theme: opts.theme,
    pageSize: opts.pageSize,
    margin: opts.margin,
    toc: opts.toc,
    background: opts.background,
    debugHtml: opts.debugHtml,
    verbose: opts.verbose,
    quiet: opts.quiet,
  });

  if (!opts.quiet) {
    console.log(`Rendered ${result.inputPath} -> ${result.outputPath}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
