---
name: Document Suite
description: Inspect, transform, generate, and verify PDF, Word, Excel, PowerPoint, CSV, API specifications, and diagrams using available local tools. Use for document extraction, conversion, report generation, spreadsheet analysis, slide decks, or PDF workflows; do not assume binary files are plain text.
trigger_words: [pdf, pdf file, docx, word document, xlsx, excel spreadsheet, csv analysis, powerpoint, pptx, slide deck, presentation, openapi, swagger, plantuml, mermaid diagram, pdf dönüştür, excel dosyası, powerpoint sunumu, word dosyası]
---

# Document suite

Identify format, desired output, fidelity requirement, privacy boundary, and available toolchain first. Inspect before mutating. Keep source files intact, use explicit output paths, and verify rendered output rather than trusting a successful command.

## Route to references
- PDF: [references/pdf.md](references/pdf.md)
- Word: [references/word.md](references/word.md)
- Spreadsheets: [references/spreadsheets.md](references/spreadsheets.md)
- PowerPoint: [references/presentations.md](references/presentations.md)
- OCR and scans: [references/ocr-and-scans.md](references/ocr-and-scans.md)
- Conversion: [references/document-conversion.md](references/document-conversion.md)
- Filing and batch organization: [references/document-filing.md](references/document-filing.md)
- Verification: [references/verification.md](references/verification.md)

## Tool reality
The `read` tool can extract PDF attachments but treats `.docx`, `.xlsx`, and `.pptx` as binary. Discover installed tools such as `pdftotext`, `pdfinfo`, LibreOffice, Pandoc, Python libraries, or format-specific utilities before choosing a workflow. Do not claim a binary was parsed when only its filename was seen.

## Related skills
- `media-analysis` for transcript, keyframe, or audio inputs.
- `frontend-design` for document viewers and review interfaces.
- `presentation-design` only when a dedicated slide design workflow is needed.

## Acceptance loop
Inspect → plan → transform a copy → render or reopen → compare key content → report artifacts and limitations.
