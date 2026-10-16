# CV and resume websites

Use when a resume, CV, or professional profile becomes a website or printable page. Preserve factual claims from user-provided material. Do not invent employers, titles, dates, metrics, awards, clients, or links. A portfolio site may need `portfolio-editorial.md` as companion; file extraction or PDF editing belongs to `document-suite`.

## Content and evidence

Identify target audience and their first decision: recruiter scan, client inquiry, academic review, or internal mobility. Build hierarchy around identity and role, short positioning, strongest proof, experience, projects, skills, education, and contact. Prefer concrete outcomes with source evidence over generic adjectives. If result has no known metric, describe action and scope accurately without fabricated numbers. Keep chronology coherent; surface employment gaps or overlapping dates accurately rather than hiding them in layout.

Separate source facts, editorial wording, and uncertain details. Use names, dates, organization spellings, and links exactly as supplied or verified. For a public site, include only intended contact fields; documents may contain private address, phone, metadata, or references that should not automatically appear online. If publication scope is unclear, keep the questionable field out while continuing the rest of the build and ask one targeted question only if necessary.

## Structure and interaction

Use semantic headings and lists so a visitor can scan by section and assistive technology can navigate. Experience entries should connect role, organization, dates, responsibility, and evidence of impact. Projects need problem, contribution, tools or method, outcome, and working link when available. Skills should be grouped by relevant capability; long undifferentiated tag clouds make assessment harder. Keep navigation simple: anchor links or a short menu often suffice. Avoid filters or tabs that hide essential content from keyboard users or print output.

Contact links must point to valid user-approved destinations. Download button should yield actual PDF or document if promised; if no PDF exists, use a clear print action instead of a dead download. External links open predictably and remain visibly distinguishable. Copy-to-clipboard controls must confirm success and have a fallback when clipboard permission fails.

## Screen and print layouts

Use readable measure, visible dates, strong section anchors, and enough contrast in light and dark themes. Check long names, localized labels, wrapping URLs, and sections with no optional content. Mobile layout should reflow into one column without horizontal overflow at 200% zoom. For print, use `@media print` to remove navigation/interactive chrome, preserve URLs or meaningful labels, avoid awkward page breaks inside entries, and keep monochrome contrast. Do not rely on background colors that browsers may omit in print.

A one-page limit is an editorial choice, not universal rule. If content cannot fit without tiny type, prioritize or allow another page. Generated PDF should contain selectable text and live links when possible. Reopen exported PDF and inspect page breaks, fonts, clipping, metadata, and link destinations.

## Acceptance checks

- Facts match source resume or user corrections; uncertain claims remain marked or omitted.
- Keyboard and screen reader heading navigation follows visual hierarchy.
- Mobile width, 200% zoom, long words, and translation do not clip content.
- Print preview and exported PDF (if offered) preserve order, dates, links, and readable text.
- Every contact, project, download, print, and navigation control works.
- No private source-only field appears in public output by accident.

## Sources reviewed

- MDN print styles and pagination: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_media_queries/Printing
- WAI-ARIA Authoring Practices for interactive controls: https://www.w3.org/WAI/ARIA/apg/
- Community portfolio skill, evidence and privacy checks; adapted without mandatory design-approval stages: https://github.com/m0bar3z/portfolio-agent-skill/blob/main/SKILL.md
- Community resume website skill, content-to-layout stages; adapted without its fixed nine-stage process: https://github.com/SanbaoAI/Resume-Website-Generator-Skill/blob/main/skill.md
