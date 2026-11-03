# Guide style rules

These rules are for anyone writing a guide in this folder, including the weekly
SEO task. Edit them freely; the task reads this file every week.

## Who we write for
People with a PDF job to do right now: a student shrinking a file to upload, an
office worker merging scans, a freelancer signing a contract. Many are on a
phone. Many care that their documents stay private.

## Voice
- Plain, friendly English. Short sentences. No hype words ("revolutionary",
  "seamless", "ultimate").
- Answer the question in the first two sentences, then explain.
- Say "your file never leaves your device" only for tools that run in the
  browser (`local: true` in `seo.js`). Server tools (Word, Excel, PowerPoint,
  PDF/A, HTML) delete files within 60 seconds; say that instead.

## Accuracy (most important)
- Only describe features that exist. Check the tool in `public/index.html`,
  `public/js/*.js(x)` and `seo.js` before writing about it.
- No invented numbers, studies, quotes or customer stories.
- Don't name competitors or make claims about them.

## Shape of a guide
- File: `guides/<keyword-slug>.md`, lowercase words with dashes.
- Front matter: `title` (60 chars max, includes the main keyword),
  `description` (150–160 chars), `tool` (one slug from `seo.js`), `date`.
- 600–1,200 words. Structure:
  1. Two-sentence answer.
  2. `## Steps` with a numbered list that matches the real tool.
  3. Two to four `##` sections on common problems, tips or "why" questions.
  4. `## Questions` with 3–4 `###` questions people really search for.
- Link to the tool once in the text, plus one or two related tools or guides,
  for example `[Compress PDF](/compress-pdf)`.
- Allowed formatting: `##`/`###`, lists, `> tips`, **bold**, *italic*,
  `code`, and links. No HTML.

## Choosing topics
- One clear search intent per guide ("how to sign a PDF on iPhone"), not a
  broad topic ("all about PDFs").
- Never write a second guide for a topic already covered; update the old one
  and set `updated:` instead.
- Prefer long-tail questions where privacy or "free, no signup" is a real
  advantage.

## Topic backlog
Pick from here first, and remove a line once its guide is merged.
- How to compress a PDF for email (under 10 MB / 25 MB)
- How to merge PDF files on iPhone without an app
- How to sign a PDF without printing it
- How to make a scanned PDF searchable (OCR)
- How to fill out a PDF form that isn't fillable
- How to remove a password from a PDF you own
- How to translate a PDF and keep the formatting
- How to check a contract for risky clauses before signing
- How to turn invoices into an Excel spreadsheet
- How to add Bates numbers to legal documents
- How to compare two versions of a PDF
- How to summarize a long PDF quickly
- How to convert a PDF to PDF/A for archiving
- How to rotate one page in a PDF
