import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const input = path.join(root, "samples", "example.md");
const output = path.join(root, "samples", "example.test.pdf");

if (fs.existsSync(output)) {
  fs.unlinkSync(output);
}

execFileSync("node", [path.join(root, "bin", "md-mermaid-pdf.js"), input, output, "--toc"], {
  cwd: root,
  stdio: "inherit"
});

const stat = fs.statSync(output);
if (stat.size < 10_000) {
  throw new Error(`Expected generated PDF to be larger than 10KB, got ${stat.size} bytes`);
}

console.log(`Smoke test passed: ${output} (${stat.size} bytes)`);
