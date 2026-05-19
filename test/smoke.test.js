import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { PDFDocument } from "pdf-lib";

const root = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(root, "src", "cli.js");
const sampleMd = path.join(root, "samples", "example.md");

test("renders example.md to a valid PDF with correct metadata", async () => {
  const output = path.join(root, "samples", "example.test.pdf");
  if (fs.existsSync(output)) fs.unlinkSync(output);

  execFileSync("node", [cliPath, sampleMd, output, "--toc"], { cwd: root, stdio: "inherit" });

  const bytes = fs.readFileSync(output);
  assert.ok(bytes.length >= 10_000, `Expected PDF ≥ 10KB, got ${bytes.length} bytes`);
  assert.equal(bytes.slice(0, 5).toString(), "%PDF-", "Expected PDF magic bytes at start of file");

  const pdfDoc = await PDFDocument.load(bytes);
  assert.equal(pdfDoc.getTitle(), "example", "PDF title should match input filename stem");
  assert.equal(pdfDoc.getAuthor(), "md-mermaid-pdf", "PDF author should be md-mermaid-pdf");
  assert.equal(pdfDoc.getCreator(), "md-mermaid-pdf", "PDF creator should be md-mermaid-pdf");
});

test("renders with --theme and --no-background flags", () => {
  const output = path.join(os.tmpdir(), `md-mermaid-pdf-test-flags-${Date.now()}.pdf`);

  execFileSync(
    "node",
    [cliPath, sampleMd, output, "--theme", "forest", "--no-background"],
    { cwd: root, stdio: "inherit" }
  );

  const bytes = fs.readFileSync(output);
  assert.ok(bytes.length >= 10_000, `Expected PDF ≥ 10KB, got ${bytes.length} bytes`);
  assert.equal(bytes.slice(0, 5).toString(), "%PDF-", "Expected PDF magic bytes");

  fs.unlinkSync(output);
});

test("exits non-zero when Mermaid diagram is malformed", () => {
  const tmpMd = path.join(os.tmpdir(), `md-mermaid-pdf-bad-${Date.now()}.md`);
  const tmpPdf = path.join(os.tmpdir(), `md-mermaid-pdf-bad-${Date.now()}.pdf`);

  fs.writeFileSync(
    tmpMd,
    "# Test\n\n```mermaid\nthis is not valid mermaid syntax !!!\n```\n"
  );

  const result = spawnSync("node", [cliPath, tmpMd, tmpPdf], { cwd: root });
  assert.notEqual(result.status, 0, "Expected non-zero exit code for malformed Mermaid");

  fs.rmSync(tmpMd, { force: true });
  fs.rmSync(tmpPdf, { force: true });
});
