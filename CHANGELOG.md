# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Programmatic API: `import { renderMarkdownToPdf } from "md-mermaid-pdf"`
- `--verbose` flag: print per-phase timing
- `--quiet` flag: suppress all output
- `-v, --version` flag
- JSDoc type annotations checked by `tsc --checkJs`
- ESLint with flat config
- GitHub Actions CI and npm publish workflows

### Fixed
- Asset resolution now uses `createRequire` so the package works correctly when installed globally or as a dependency (previously resolved assets from a hardcoded project root)

### Changed
- Source moved from `bin/md-mermaid-pdf.js` to `src/cli.js` + `src/index.js`
- Smoke test migrated to `node:test` with PDF magic-byte check, metadata assertions, flags fixture, and malformed-Mermaid negative test

## [0.1.0] - 2026-05-19

### Added
- Initial release
- CLI: render GitHub-flavoured Markdown with Mermaid diagrams to PDF
- Options: `--title`, `--author`, `--theme`, `--page-size`, `--margin`, `--toc`, `--no-background`, `--debug-html`
