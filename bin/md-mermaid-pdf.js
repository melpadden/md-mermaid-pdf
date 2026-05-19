#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import markdownItTaskLists from "markdown-it-task-lists";
import hljs from "highlight.js";
import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const program = new Command();

program
  .name("md-mermaid-pdf")
  .description("Render GitHub-flavoured Markdown with Mermaid diagrams to PDF.")
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
  .parse();

const options = program.opts();
const [inputArg, outputArg] = program.args;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugifyHeading(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function collectHeadings(markdown) {
  const headings = [];
  const used = new Map();
  const headingPattern = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;
  let match;

  while ((match = headingPattern.exec(markdown)) !== null) {
    const level = match[1].length;
    if (level < 2 || level > 4) {
      continue;
    }

    const text = match[2]
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/[`*_~]/g, "")
      .trim();
    const baseSlug = slugifyHeading(text) || "section";
    const count = used.get(baseSlug) ?? 0;
    used.set(baseSlug, count + 1);

    headings.push({
      level,
      text,
      id: count === 0 ? baseSlug : `${baseSlug}-${count}`
    });
  }

  return headings;
}

function buildToc(headings) {
  if (!headings.length) {
    return "";
  }

  const items = headings
    .map((heading) => {
      const indent = Math.max(0, heading.level - 2);
      return `<li class="toc-level-${heading.level}" style="margin-left:${indent * 1.1}rem"><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a></li>`;
    })
    .join("\n");

  return `
    <nav class="toc">
      <h2>Table of contents</h2>
      <ul>${items}</ul>
    </nav>
  `;
}

function createMarkdownRenderer() {
  const md = markdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight(code, language) {
      const lang = language && hljs.getLanguage(language) ? language : "plaintext";
      return `<pre><code class="hljs language-${escapeHtml(lang)}">${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
    }
  })
    .use(markdownItTaskLists, { enabled: true, label: true, labelAfter: true })
    .use(markdownItAnchor, {
      level: [1, 2, 3, 4, 5, 6],
      slugify: slugifyHeading,
      permalink: markdownItAnchor.permalink.linkInsideHeader({
        symbol: "#",
        placement: "after",
        class: "anchor"
      })
    });

  const originalFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, rendererOptions, env, self) => {
    const token = tokens[idx];
    const info = token.info.trim().split(/\s+/)[0].toLowerCase();

    if (info === "mermaid") {
      const diagramNumber = (env.mermaidCount = (env.mermaidCount ?? 0) + 1);
      return `<figure class="mermaid-figure"><div class="mermaid" data-diagram="${diagramNumber}">${escapeHtml(token.content)}</div></figure>`;
    }

    return originalFence(tokens, idx, rendererOptions, env, self);
  };

  return md;
}

async function readPackageAsset(packageName, relativePath) {
  const packageJsonPath = path.join(projectRoot, "node_modules", packageName, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new Error(`Missing dependency asset for ${packageName}. Run npm install first.`);
  }

  const packageRoot = path.dirname(packageJsonPath);
  return fs.readFile(path.join(packageRoot, relativePath), "utf8");
}

async function buildHtml(markdown, title, opts, inputPath) {
  const md = createMarkdownRenderer();
  const env = {};
  const body = md.render(markdown, env);
  const toc = opts.toc ? buildToc(collectHeadings(markdown)) : "";
  const baseHref = pathToFileURL(path.dirname(inputPath) + path.sep).href;
  const [githubCss, highlightCss, mermaidBundle] = await Promise.all([
    readPackageAsset("github-markdown-css", "github-markdown.css"),
    readPackageAsset("highlight.js", "styles/github.css"),
    readPackageAsset("mermaid", "dist/mermaid.min.js")
  ]);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <base href="${baseHref}">
    <title>${escapeHtml(title)}</title>
    <style>${githubCss}</style>
    <style>${highlightCss}</style>
    <style>
      :root {
        --page-bg: #ffffff;
        --page-text: #24292f;
        --page-muted: #57606a;
        --page-border: #d0d7de;
        --page-link: #0969da;
      }

      html, body {
        background: var(--page-bg);
      }

      body {
        margin: 0;
        color: var(--page-text);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
      }

      .page {
        box-sizing: border-box;
        max-width: 980px;
        margin: 0 auto;
        padding: 32px;
      }

      .markdown-body {
        font-size: 16px;
        line-height: 1.55;
      }

      .markdown-body .anchor {
        color: var(--page-muted);
        margin-left: 0.35em;
        opacity: 0;
        text-decoration: none;
      }

      .markdown-body h1:hover .anchor,
      .markdown-body h2:hover .anchor,
      .markdown-body h3:hover .anchor,
      .markdown-body h4:hover .anchor,
      .markdown-body h5:hover .anchor,
      .markdown-body h6:hover .anchor {
        opacity: 1;
      }

      .toc {
        border: 1px solid var(--page-border);
        border-radius: 6px;
        padding: 16px 20px;
        margin: 0 0 24px;
        background: #f6f8fa;
      }

      .toc h2 {
        border-bottom: 0;
        margin: 0 0 8px;
        padding: 0;
        font-size: 18px;
      }

      .toc ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .toc li {
        margin-top: 6px;
      }

      .toc a {
        color: var(--page-link);
        text-decoration: none;
      }

      .mermaid-figure {
        margin: 24px 0;
        overflow-x: auto;
        text-align: center;
      }

      .mermaid {
        display: inline-block;
        max-width: 100%;
      }

      .mermaid svg {
        max-width: 100%;
        height: auto;
      }

      pre, code {
        break-inside: avoid;
      }

      table, blockquote, .mermaid-figure {
        break-inside: avoid;
      }

      @page {
        margin: ${escapeHtml(opts.margin)};
      }

      @media print {
        .page {
          max-width: none;
          padding: 0;
        }

        .markdown-body {
          font-size: 14px;
        }

        .markdown-body a {
          color: var(--page-link);
          text-decoration: none;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <article class="markdown-body">
        ${toc}
        ${body}
      </article>
    </main>
    <script>${mermaidBundle}</script>
    <script>
      const diagrams = [...document.querySelectorAll(".mermaid")];
      window.__mermaidErrors = [];
      window.__mermaidDone = diagrams.length === 0;

      (async () => {
        try {
          if (!window.mermaid) {
            throw new Error("Mermaid browser bundle did not initialize.");
          }

          window.mermaid.initialize({
            startOnLoad: false,
            theme: ${JSON.stringify(opts.theme)},
            securityLevel: "loose"
          });

          if (diagrams.length > 0) {
            await window.mermaid.run({ nodes: diagrams });
          }
        } catch (error) {
          window.__mermaidErrors.push(error?.message || String(error));
        } finally {
          window.__mermaidDone = true;
        }
      })();
    </script>
  </body>
</html>`;
}

async function main() {
  const inputPath = path.resolve(inputArg);
  const outputPath = path.resolve(outputArg ?? inputPath.replace(/\.[^.]+$/, "") + ".pdf");

  if (!existsSync(inputPath)) {
    throw new Error(`Input file does not exist: ${inputPath}`);
  }

  const markdown = await fs.readFile(inputPath, "utf8");
  const title = options.title ?? path.basename(inputPath, path.extname(inputPath));
  const html = await buildHtml(markdown, title, options, inputPath);
  const htmlPath = options.debugHtml
    ? path.resolve(options.debugHtml)
    : path.join(await fs.mkdtemp(path.join(os.tmpdir(), "md-mermaid-pdf-")), "document.html");

  await fs.mkdir(path.dirname(htmlPath), { recursive: true });
  await fs.writeFile(htmlPath, html, "utf8");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });

  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__mermaidDone === true, null, { timeout: 30000 }).catch((error) => {
      const details = browserErrors.length ? `\nBrowser errors:\n${browserErrors.join("\n")}` : "";
      throw new Error(`${error.message}${details}`);
    });

    const mermaidErrors = await page.evaluate(() => window.__mermaidErrors ?? []);
    if (mermaidErrors.length > 0) {
      throw new Error(`Mermaid rendering failed in ${inputPath}:\n${mermaidErrors.join("\n")}`);
    }

    await page.pdf({
      path: outputPath,
      format: options.pageSize,
      printBackground: options.background,
      preferCSSPageSize: false
    });

    const pdfBytes = await fs.readFile(outputPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    pdfDoc.setTitle(title);
    pdfDoc.setAuthor(options.author);
    pdfDoc.setCreator("md-mermaid-pdf");
    pdfDoc.setProducer("md-mermaid-pdf");
    pdfDoc.setCreationDate(new Date());
    pdfDoc.setModificationDate(new Date());
    await fs.writeFile(outputPath, await pdfDoc.save());
  } finally {
    await browser.close();
  }

  console.log(`Rendered ${inputPath} -> ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
