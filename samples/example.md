# Example Documentation

This file demonstrates GitHub-flavoured Markdown rendering with tables, task lists, code blocks, and Mermaid diagrams.

## Architecture

```mermaid
flowchart LR
    Author[Markdown author] --> CLI[md-mermaid-pdf CLI]
    CLI --> HTML[GitHub-like HTML]
    HTML --> PDF[PDF document]
    CLI --> Errors[Clear diagram errors]
```

## Deployment sequence

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant CLI as CLI
    participant Browser as Chromium
    participant PDF as PDF

    Dev->>CLI: md-mermaid-pdf docs.md docs.pdf
    CLI->>Browser: Load rendered HTML
    Browser->>Browser: Render Mermaid diagrams
    Browser->>PDF: Print to PDF
    PDF-->>Dev: Documentation artifact
```

## Markdown features

- [x] Tables
- [x] Task lists
- [x] Syntax highlighting
- [x] Mermaid diagrams

| Feature | Status | Notes |
| --- | --- | --- |
| Mermaid | Supported | Fenced `mermaid` blocks become diagrams |
| Code | Supported | Uses Highlight.js GitHub theme |
| PDF | Supported | Printed through Chromium |

```python
from pathlib import Path

def docs_changed(path: Path) -> bool:
    return path.suffix == ".md"
```

> The styling intentionally follows GitHub Markdown conventions rather than a bespoke report design.
