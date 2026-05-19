import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import markdownItTaskLists from "markdown-it-task-lists";
import hljs from "highlight.js";
import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);

/**
 * @typedef {Object} RenderOptions
 * @property {string} [title] - Document title; defaults to the input file's basename
 * @property {string} [author] - PDF author metadata
 * @property {string} [theme] - Mermaid theme (default, forest, dark, neutral)
 * @property {string} [pageSize] - PDF page size (A4, Letter, etc.)
 * @property {string} [margin] - CSS page margin (e.g. 18mm, 0.5in)
 * @property {boolean} [toc] - Inject a table of contents
 * @property {boolean} [background] - Print CSS backgrounds
 * @property {string} [debugHtml] - Write intermediate HTML to this path
 * @property {boolean} [verbose] - Print timing for each phase
 * @property {boolean} [quiet] - Suppress all output
 */

/** @param {string} value @returns {string} */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** @param {string} value @returns {string} */
function slugifyHeading(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * @param {string} markdown
 * @returns {{ level: number, text: string, id: string }[]}
 */
function collectHeadings(markdown) {
  const headings = [];
  const used = new Map();
  const headingPattern = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;
  let match;

  while ((match = headingPattern.exec(markdown)) !== null) {
    const level = match[1].length;
    if (level < 2 || level > 4) continue;

    const text = match[2]
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/[`*_~]/g, "")
      .trim();
    const baseSlug = slugifyHeading(text) || "section";
    const count = used.get(baseSlug) ?? 0;
    used.set(baseSlug, count + 1);

    headings.push({ level, text, id: count === 0 ? baseSlug : `${baseSlug}-${count}` });
  }

  return headings;
}

/**
 * @param {{ level: number, text: string, id: string }[]} headings
 * @returns {string}
 */
function buildToc(headings) {
  if (!headings.length) return "";

  const items = headings
    .map((h) => {
      const indent = Math.max(0, h.level - 2);
      return `<li class="toc-level-${h.level}" style="margin-left:${indent * 1.1}rem"><a href="#${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`;
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

    return originalFence
      ? originalFence(tokens, idx, rendererOptions, env, self)
      : self.renderToken(tokens, idx, rendererOptions);
  };

  return md;
}

/**
 * Resolves a file path within an installed npm package using Node module resolution,
 * so it works correctly whether the package is installed globally, locally, or run from source.
 * @param {string} packageName
 * @param {string} relativePath
 * @returns {string}
 */
function resolvePackageAsset(packageName, relativePath) {
  const pkgJsonPath = require.resolve(`${packageName}/package.json`);
  return path.join(path.dirname(pkgJsonPath), relativePath);
}

/**
 * @param {string} markdown
 * @param {string} title
 * @param {Required<RenderOptions>} opts
 * @param {string} inputPath
 * @returns {Promise<string>}
 */
async function buildHtml(markdown, title, opts, inputPath) {
  const md = createMarkdownRenderer();
  const env = {};
  const body = md.render(markdown, env);
  const toc = opts.toc ? buildToc(collectHeadings(markdown)) : "";
  const baseHref = pathToFileURL(path.dirname(inputPath) + path.sep).href;
  const [githubCss, highlightCss, mermaidBundle] = await Promise.all([
    fs.readFile(resolvePackageAsset("github-markdown-css", "github-markdown.css"), "utf8"),
    fs.readFile(resolvePackageAsset("highlight.js", "styles/github.css"), "utf8"),
    fs.readFile(resolvePackageAsset("mermaid", "dist/mermaid.min.js"), "utf8")
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

/**
 * Render a Markdown file (with optional Mermaid diagrams) to PDF.
 *
 * @param {string} inputPath - Absolute or relative path to the Markdown file
 * @param {string} [outputPath] - Output PDF path; defaults to inputPath with .pdf extension
 * @param {RenderOptions} [options]
 * @returns {Promise<{ inputPath: string, outputPath: string }>}
 */
export async function renderMarkdownToPdf(inputPath, outputPath, options = {}) {
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(
    outputPath ?? resolvedInput.replace(/\.[^.]+$/, "") + ".pdf"
  );

  const opts = /** @type {Required<RenderOptions>} */ ({
    title: options.title ?? path.basename(resolvedInput, path.extname(resolvedInput)),
    author: options.author ?? "md-mermaid-pdf",
    theme: options.theme ?? "default",
    pageSize: options.pageSize ?? "A4",
    margin: options.margin ?? "18mm",
    toc: options.toc ?? false,
    background: options.background ?? true,
    debugHtml: options.debugHtml ?? "",
    verbose: options.verbose ?? false,
    quiet: options.quiet ?? false,
  });

  const log = opts.verbose && !opts.quiet ? (/** @type {string} */ msg) => console.log(msg) : () => {};

  if (!existsSync(resolvedInput)) {
    throw new Error(`Input file does not exist: ${resolvedInput}`);
  }

  let t = performance.now();

  const markdown = await fs.readFile(resolvedInput, "utf8");
  log(`  read markdown: ${(performance.now() - t).toFixed(0)}ms`); t = performance.now();

  const html = await buildHtml(markdown, opts.title, opts, resolvedInput);
  log(`  built HTML: ${(performance.now() - t).toFixed(0)}ms`); t = performance.now();

  const htmlPath = opts.debugHtml
    ? path.resolve(opts.debugHtml)
    : path.join(await fs.mkdtemp(path.join(os.tmpdir(), "md-mermaid-pdf-")), "document.html");

  await fs.mkdir(path.dirname(htmlPath), { recursive: true });
  await fs.writeFile(htmlPath, html, "utf8");
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (/** @type {any} */ error) {
    if (String(error?.message).includes("Executable doesn't exist")) {
      throw new Error(
        "Chromium is not installed. Run: npx playwright install chromium"
      );
    }
    throw error;
  }
  log(`  launched browser: ${(performance.now() - t).toFixed(0)}ms`); t = performance.now();

  const page = await browser.newPage();
  /** @type {string[]} */
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
    // Callbacks run in Chromium context; window globals are set by the injected mermaid script
    // @ts-ignore
    // eslint-disable-next-line no-undef
    await page.waitForFunction(() => window.__mermaidDone === true, null, { timeout: 30000 }).catch((error) => {
      const details = browserErrors.length ? `\nBrowser errors:\n${browserErrors.join("\n")}` : "";
      throw new Error(`${error.message}${details}`);
    });

    // @ts-ignore
    // eslint-disable-next-line no-undef
    const mermaidErrors = await page.evaluate(() => window.__mermaidErrors ?? []);
    if (mermaidErrors.length > 0) {
      throw new Error(`Mermaid rendering failed in ${resolvedInput}:\n${mermaidErrors.join("\n")}`);
    }
    log(`  rendered diagrams: ${(performance.now() - t).toFixed(0)}ms`); t = performance.now();

    await page.pdf({
      path: resolvedOutput,
      format: opts.pageSize,
      printBackground: opts.background,
      preferCSSPageSize: false
    });
    log(`  printed PDF: ${(performance.now() - t).toFixed(0)}ms`); t = performance.now();

    const pdfBytes = await fs.readFile(resolvedOutput);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    pdfDoc.setTitle(opts.title);
    pdfDoc.setAuthor(opts.author);
    pdfDoc.setCreator("md-mermaid-pdf");
    pdfDoc.setProducer("md-mermaid-pdf");
    pdfDoc.setCreationDate(new Date());
    pdfDoc.setModificationDate(new Date());
    await fs.writeFile(resolvedOutput, await pdfDoc.save());
    log(`  wrote metadata: ${(performance.now() - t).toFixed(0)}ms`);
  } finally {
    await browser.close();
  }

  return { inputPath: resolvedInput, outputPath: resolvedOutput };
}
