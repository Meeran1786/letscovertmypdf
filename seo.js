/* Server-rendered SEO for each tool URL (/merge-pdf, /chat-with-pdf, …).
   The SPA is one HTML file that builds itself in the browser, which search
   engines index poorly. For every tool URL the server sends that same file
   with its own title, description, canonical URL, FAQ structured data and a
   readable article inside #root. React replaces the article on load, so
   visitors see the app and crawlers see a real page.
   Keep slugs in sync with TOOLS in public/index.html. */

const SITE = 'https://letsconvertpdf.com';

const LOCAL = 'Your file is processed inside your browser and is never uploaded to our servers.';
const SERVER = 'Your file is sent over HTTPS to our converter, processed in an isolated folder and deleted within 60 seconds.';

/** slug → page content. `local` decides which privacy line is shown. */
const PAGES = {
  'chat-with-pdf': {
    title: 'Chat with PDF Free — Private AI That Runs on Your Device',
    h1: 'Chat with your PDF, privately',
    desc: 'Ask questions about any PDF and get answers with page references. The AI runs in your browser, so your document is never uploaded. Free, no signup.',
    intro: 'Upload a contract, report, paper or manual and ask it anything. Every answer links to the page it came from, so you can check it in one click. Unlike other "chat with PDF" tools, the AI model runs on your own device: your document and your questions never reach anyone\'s server.',
    steps: ['Choose a PDF from your device.', 'Pick Instant mode (works everywhere) or Smart AI (an on-device language model).', 'Ask a question and click any page reference to see the source.'],
    faq: [
      ['Is my document sent to an AI company?', 'No. Smart AI downloads an open model to your browser once and runs it locally with WebGPU. Instant mode needs no model at all. Your text never leaves your device.'],
      ['Does it work with scanned PDFs?', 'Yes. If the PDF has no text layer, we offer to run OCR on your device first, then you can chat with it.'],
      ['What devices support Smart AI?', 'Recent Chrome or Edge on a laptop or desktop with WebGPU. Every other device can use Instant mode, which quotes the exact sentences that answer your question.'],
    ],
    local: true,
  },
  'summarize-pdf': {
    title: 'Summarize PDF Free — AI Summary Without Uploading',
    h1: 'Summarize any PDF in seconds',
    desc: 'Get the key points and action items from a PDF with page references. On-device AI: your file is never uploaded. Free and private.',
    intro: 'Turn a long PDF into a short list of key points, decisions and deadlines. Each point links to its page so you can verify it. The summary is produced on your device, so confidential documents stay confidential.',
    steps: ['Choose a PDF.', 'Read the instant summary, or switch to Smart AI for a written summary.', 'Copy it or download it as a text file.'],
    faq: [
      ['How long can the PDF be?', 'Instant mode handles documents of hundreds of pages. Smart AI reads long documents in sections and then combines them.'],
      ['Is the summary accurate?', 'Instant mode quotes sentences directly from your document. Smart AI writes its own wording and cites pages; always check important facts against the cited page.'],
    ],
    local: true,
  },
  'ocr-pdf': {
    title: 'OCR PDF Free — Make Scanned PDFs Searchable, Privately',
    h1: 'Make scanned PDFs searchable',
    desc: 'Add a searchable, selectable text layer to scanned PDFs. OCR runs in your browser; nothing is uploaded. Free online OCR.',
    intro: 'Scanned contracts, receipts and old documents are just pictures of text. OCR PDF recognises the words and adds an invisible text layer, so you can search, select and copy them, while every page looks exactly the same.',
    steps: ['Choose a scanned PDF.', 'Wait a few seconds per page while your device reads the text.', 'Download the searchable PDF.'],
    faq: [
      ['Which languages are supported?', 'English today. More languages are coming.'],
      ['Will my PDF look different?', 'No. The text layer is invisible; the original page images are untouched.'],
    ],
    local: true,
  },
  'merge-pdf': {
    title: 'Merge PDF Free — Combine PDFs Without Uploading',
    h1: 'Merge PDF files',
    desc: 'Combine multiple PDFs into one file in the order you choose. Runs in your browser: files are never uploaded. Free, no signup.',
    intro: 'Put several PDFs together into a single document. Reorder the files before merging; pages keep their original quality.',
    steps: ['Choose two or more PDFs.', 'Drag them into the order you want.', 'Merge and download one PDF.'],
    faq: [['Is there a file limit?', 'No fixed limit; it depends on your device\'s memory. Files of several hundred pages merge in seconds.']],
    local: true,
  },
  'split-pdf': {
    title: 'Split PDF Free — Separate PDF Pages Privately',
    h1: 'Split a PDF into pages',
    desc: 'Split a PDF into one file per page, downloaded as a ZIP. Processed in your browser, never uploaded. Free.',
    intro: 'Separate every page of a PDF into its own file. All pages are packaged in a ZIP for one download.',
    steps: ['Choose a PDF.', 'Split it.', 'Download single pages or everything as a ZIP.'],
    faq: [['Do the pages lose quality?', 'No. Pages are copied as they are, without re-rendering.']],
    local: true,
  },
  'organize-pdf': {
    title: 'Organize PDF Pages Free — Reorder and Delete Pages',
    h1: 'Reorder and delete PDF pages',
    desc: 'Rearrange, remove or duplicate PDF pages by typing the order you want. Runs privately in your browser. Free.',
    intro: 'Type the page order you want, leaving out pages to delete, and get a new PDF in that order.',
    steps: ['Choose a PDF.', 'Enter the new page order, for example 3,1,2.', 'Download the reorganised PDF.'],
    faq: [['How do I delete a page?', 'Leave its number out of the order.']],
    local: true,
  },
  'crop-pdf': {
    title: 'Crop PDF Free — Trim PDF Margins Online',
    h1: 'Crop PDF margins',
    desc: 'Trim white margins from every page of a PDF. Processed on your device, never uploaded. Free.',
    intro: 'Remove unwanted margins from all pages at once, useful for reading on phones and e-readers.',
    steps: ['Choose a PDF.', 'Set how much margin to remove.', 'Download the cropped PDF.'],
    faq: [['Is cropped content deleted?', 'It is hidden by the new page box; the PDF keeps the original content underneath.']],
    local: true,
  },
  'rotate-pdf': {
    title: 'Rotate PDF Free — Turn PDF Pages Permanently',
    h1: 'Rotate PDF pages',
    desc: 'Rotate PDF pages by 90, 180 or 270 degrees and save it permanently. Runs in your browser. Free.',
    intro: 'Fix sideways or upside-down scans by rotating pages and saving the result.',
    steps: ['Choose a PDF.', 'Pick the rotation.', 'Download the rotated PDF.'],
    faq: [['Is rotation permanent?', 'Yes, the rotation is saved in the file.']],
    local: true,
  },
  'compress-pdf': {
    title: 'Compress PDF Free — Reduce PDF Size Without Uploading',
    h1: 'Compress a PDF',
    desc: 'Shrink PDF file size by re-compressing images, right in your browser. Text stays sharp. Your file is never uploaded. Free.',
    intro: 'Make a PDF small enough to email or upload. We re-compress the images inside it at the strength you choose, while text, fonts and vector graphics stay exactly as they were.',
    steps: ['Choose a PDF.', 'Pick Light, Recommended or Strong compression.', 'Download the smaller file and see how much you saved.'],
    faq: [
      ['How much smaller will my PDF get?', 'Image-heavy PDFs such as scans and brochures often shrink by 50 to 90 percent. Text-only PDFs are already small and may not change.'],
      ['Will text become blurry?', 'No. Only images are re-compressed; text stays vector and searchable.'],
    ],
    local: true,
  },
  'jpg-to-pdf': {
    title: 'JPG to PDF Free — Convert Images to PDF Privately',
    h1: 'Convert images to PDF',
    desc: 'Turn JPG, PNG, WebP and other images into a single PDF. Converted in your browser, never uploaded. Free.',
    intro: 'Combine photos, scans or screenshots into one PDF, one image per page.',
    steps: ['Choose one or more images.', 'Put them in order.', 'Download the PDF.'],
    faq: [['Which formats work?', 'JPG, PNG, WebP, GIF, BMP and most other formats your browser can display.']],
    local: true,
  },
  'pdf-to-jpg': {
    title: 'PDF to JPG Free — Save PDF Pages as Images',
    h1: 'Convert PDF to JPG',
    desc: 'Save every page of a PDF as a high-quality JPG image. Converted on your device. Free.',
    intro: 'Export each page as a sharp JPG image, ready for slides, chats or social posts.',
    steps: ['Choose a PDF.', 'Convert it.', 'Download single images or a ZIP.'],
    faq: [['What resolution are the images?', 'About 192 DPI, sharp enough for screens and most printing.']],
    local: true,
  },
  'word-to-pdf': {
    title: 'Word to PDF Free — Convert DOCX to PDF',
    h1: 'Convert Word to PDF',
    desc: 'Convert DOCX, DOC, ODT and RTF to PDF with fonts, tables and layout preserved. Files are deleted within 60 seconds. Free.',
    intro: 'Turn a Word document into a PDF that looks the same on every device.',
    steps: ['Choose a Word file.', 'Convert it.', 'Download the PDF.'],
    faq: [['Why does this tool use a server?', 'Word conversion needs a full office suite that can\'t run in a browser yet. Your file is deleted within 60 seconds.']],
    local: false,
  },
  'excel-to-pdf': {
    title: 'Excel to PDF Free — Convert XLSX to PDF',
    h1: 'Convert Excel to PDF',
    desc: 'Convert Excel spreadsheets to PDF, including multi-sheet workbooks. Files are deleted within 60 seconds. Free.',
    intro: 'Share spreadsheets as clean PDFs that anyone can open.',
    steps: ['Choose an Excel file.', 'Convert it.', 'Download the PDF.'],
    faq: [['Are all sheets included?', 'Yes, every sheet becomes pages in the PDF.']],
    local: false,
  },
  'ppt-to-pdf': {
    title: 'PowerPoint to PDF Free — Convert PPTX to PDF',
    h1: 'Convert PowerPoint to PDF',
    desc: 'Convert PPTX and PPT presentations to PDF, one slide per page. Files are deleted within 60 seconds. Free.',
    intro: 'Send presentations as PDFs that open anywhere and can\'t be accidentally edited.',
    steps: ['Choose a presentation.', 'Convert it.', 'Download the PDF.'],
    faq: [['Are animations kept?', 'PDFs are static, so each slide is saved in its final state.']],
    local: false,
  },
  'pdf-to-word': {
    title: 'PDF to Word Free — Convert PDF to Editable DOCX',
    h1: 'Convert PDF to Word',
    desc: 'Turn a PDF into an editable Word document with paragraphs and tables rebuilt. Files are deleted within 60 seconds. Free.',
    intro: 'Edit the text of a PDF in Word. We rebuild real paragraphs and tables instead of floating text boxes.',
    steps: ['Choose a PDF.', 'Convert it.', 'Download the DOCX.'],
    faq: [['Does it work on scanned PDFs?', 'Run OCR PDF first so the text can be recognised.']],
    local: false,
  },
  'pdf-to-excel': {
    title: 'PDF to Excel Free — Extract Tables to XLSX',
    h1: 'Convert PDF to Excel',
    desc: 'Extract tables from a PDF into an editable Excel spreadsheet. Files are deleted within 60 seconds. Free.',
    intro: 'Pull tables out of statements, invoices and reports into rows and columns you can work with.',
    steps: ['Choose a PDF.', 'Convert it.', 'Download the XLSX.'],
    faq: [['What if my PDF has no tables?', 'The text of each page is placed in its own sheet instead.']],
    local: false,
  },
  'pdf-to-ppt': {
    title: 'PDF to PowerPoint Free — Convert PDF to PPTX',
    h1: 'Convert PDF to PowerPoint',
    desc: 'Convert PDF pages into PowerPoint slides. Files are deleted within 60 seconds. Free.',
    intro: 'Reuse PDF pages in a presentation, one page per slide.',
    steps: ['Choose a PDF.', 'Convert it.', 'Download the PPTX.'],
    faq: [['Can I edit the slides?', 'Yes, text and images are placed on editable slides.']],
    local: false,
  },
  'watermark-pdf': {
    title: 'Watermark PDF Free — Add Text Watermarks Privately',
    h1: 'Add a watermark to a PDF',
    desc: 'Stamp CONFIDENTIAL, DRAFT or any text across every PDF page. Runs in your browser, never uploaded. Free.',
    intro: 'Mark documents as confidential or draft with a diagonal text watermark in the size, colour and opacity you choose.',
    steps: ['Choose a PDF.', 'Type the watermark text and style it.', 'Download the watermarked PDF.'],
    faq: [['Why watermark privately?', 'Documents you watermark are usually sensitive. Here they never leave your device.']],
    local: true,
  },
  'sign-pdf': {
    title: 'Sign PDF Free — Add Your Signature Anywhere, Privately',
    h1: 'Sign a PDF',
    desc: 'Draw, type or upload your signature and drag it anywhere on any page. Add the date. Your document is never uploaded. Free.',
    intro: 'Sign contracts and forms without printing. Draw your signature, type it in a handwriting font, or upload a photo of it, then drag it exactly where it belongs.',
    steps: ['Choose a PDF.', 'Create your signature and drag it into place.', 'Download the signed PDF.'],
    faq: [
      ['Is my signature stored?', 'Only if you tick "Remember my signature", and then only in your own browser.'],
      ['Is this a legally binding e-signature?', 'It is a visual signature, accepted for many everyday documents. Some contracts require a certified digital signature.'],
    ],
    local: true,
  },
  'protect-pdf': {
    title: 'Protect PDF Free — Password Protect a PDF (AES-256)',
    h1: 'Password-protect a PDF',
    desc: 'Encrypt a PDF with AES-256 so it needs a password to open. Encrypted on your device; we never see the file or password. Free.',
    intro: 'Lock a PDF before you share it. Encryption happens in your browser, so neither your document nor your password ever reaches us.',
    steps: ['Choose a PDF.', 'Enter a strong password twice.', 'Download the encrypted PDF.'],
    faq: [['What if I forget the password?', 'There is no way to recover it, because we never see it. Keep it somewhere safe.']],
    local: true,
  },
  'unlock-pdf': {
    title: 'Unlock PDF Free — Remove a PDF Password',
    h1: 'Remove a PDF password',
    desc: 'Remove the password from a PDF you own. Decrypted in your browser, never uploaded. Free.',
    intro: 'Remove the open password or editing restrictions from your own PDFs so you don\'t have to type it every time.',
    steps: ['Choose a protected PDF.', 'Enter its password.', 'Download the unlocked PDF.'],
    faq: [['Can you crack a password I don\'t know?', 'No. You need the password; only unlock files you are allowed to.']],
    local: true,
  },
  'repair-pdf': {
    title: 'Repair PDF Free — Fix Damaged or Corrupt PDFs',
    h1: 'Repair a damaged PDF',
    desc: 'Recover corrupt PDFs that won\'t open. Repaired in your browser, never uploaded. Free.',
    intro: 'Rebuild broken PDF structure so the file opens again. If a file is badly damaged, we recreate every page that can still be read.',
    steps: ['Choose a damaged PDF.', 'Repair it.', 'Preview and download the result.'],
    faq: [['Will every file be recovered?', 'Most files with broken structure are. Files with missing data can only be partly recovered.']],
    local: true,
  },
  'edit-pdf': {
    title: 'Edit PDF Free — Add Text, White-out and Images Privately',
    h1: 'Edit a PDF',
    desc: 'Add text, white-out, highlights, boxes and images anywhere on any page. Edited in your browser, never uploaded. Free.',
    intro: 'Click to add text, cover mistakes with white-out, highlight key lines, draw boxes or place a logo, on any page. Drag and resize everything until it sits right.',
    steps: ['Choose a PDF.', 'Add text, white-out, highlights, boxes or images and drag them into place.', 'Download the edited PDF.'],
    faq: [['Can I change existing text?', 'Cover it with white-out and type the new text on top. True in-place text editing is on our roadmap.']],
    local: true,
  },
  'fill-pdf-form': {
    title: 'Fill PDF Form Free — Autofill Forms Privately',
    h1: 'Fill in PDF forms in one click',
    desc: 'Fill any fillable PDF form and autofill your name, email and address from a profile stored only on your device. Free, never uploaded.',
    intro: 'Stop typing the same details into every form. Save your profile once in this browser, and we match it to fields like "First Name", "applicant_email" or "Postcode" automatically.',
    steps: ['Choose a fillable PDF form.', 'Click Autofill, then check and complete the remaining fields.', 'Download the filled form, optionally locked so answers can\'t change.'],
    faq: [
      ['Where is my profile stored?', 'Only in your own browser. It is never sent to us.'],
      ['What if my PDF has no fields?', 'Use Edit PDF to type directly onto the page.'],
    ],
    local: true,
  },
  'redact-pdf': {
    title: 'Redact PDF Free — Permanently Remove Sensitive Data',
    h1: 'Redact a PDF, properly',
    desc: 'Automatically find and permanently black out emails, phone, card, IBAN and ID numbers. Redaction happens on your device. Free.',
    intro: 'Smart Redact scans your document for personal and financial details, lets you choose what to hide, and removes it for good. Many tools only draw a black box over text that can still be copied; we rebuild the affected pages so the text is gone.',
    steps: ['Choose a PDF.', 'Review what was found and add any names or words of your own.', 'Download the redacted PDF.'],
    faq: [
      ['Is the redacted text really gone?', 'Yes. Pages with redactions are rebuilt as images with the areas blacked out, and document metadata is cleared.'],
      ['Why does this matter for privacy?', 'You are redacting because the document is sensitive. Here it never leaves your device.'],
    ],
    local: true,
  },
  'translate-pdf': {
    title: 'Translate PDF Free — Keep the Layout, Private On-Device Translation',
    h1: 'Translate a PDF and keep its layout',
    desc: 'Translate PDFs into 22 languages including Spanish, Arabic, Urdu, Hindi and Chinese. The layout stays put and the file never leaves your device. Free.',
    intro: 'Most PDF translators upload your document to a server. This one translates in your browser, then writes each translated paragraph back into the same place on the page, so tables, images and headings stay where they were. Compare the original and the translation side by side before you download.',
    steps: ['Choose a PDF.', 'Pick the language to translate into.', 'Check the side-by-side view, then download the translated PDF or just the text.'],
    faq: [
      ['Which languages are supported?', 'English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Turkish, Swedish, Indonesian, Vietnamese, Russian, Ukrainian, Arabic, Urdu, Persian, Hindi, Bengali, Chinese, Japanese and Korean.'],
      ['Is my document uploaded?', 'No. Translation uses the translator built into your browser, or our on-device AI, so the text stays on your device.'],
      ['Can I translate a scanned PDF?', 'Yes. We recognise the text with on-device OCR first, then translate it.'],
    ],
    local: true,
  },
  'review-contract': {
    title: 'Review a Contract Free — Find Risky Clauses Before You Sign',
    h1: 'Review a contract before you sign',
    desc: 'Flags auto-renewal, unlimited liability, non-competes, penalties, blanks left to fill and unsigned pages, with page references. Checked on your device. Free.',
    intro: 'Get a quick checklist of what to look at in a contract, lease or NDA: risky clauses, missing basics like governing law or termination, blanks nobody filled in, and signature lines that still look empty. Each finding links to the page it came from. With Smart AI, get a plain-English explanation too.',
    steps: ['Choose the contract PDF.', 'Read the flagged clauses and key terms, each with its page.', 'Download the report to share or keep.'],
    faq: [
      ['Is this legal advice?', 'No. It is a checklist to help you spot things worth asking about. For important agreements, talk to a lawyer.'],
      ['Is my contract uploaded?', 'No. The review runs entirely in your browser.'],
    ],
    local: true,
  },
  'pdf-data-to-excel': {
    title: 'Invoices and Receipts to Excel Free — Extract PDF Data Privately',
    h1: 'Pull invoice and receipt data into Excel',
    desc: 'Extract tables, invoice numbers, dates and totals from many PDFs into one clean Excel file. Works on scans too. Processed on your device. Free.',
    intro: 'Drop a batch of invoices, receipts or statements and get one spreadsheet: a summary row per document (vendor, invoice number, dates, tax and total), every table on its own sheet, and all "Label: value" fields. Your financial documents never leave your device.',
    steps: ['Choose one or more PDFs.', 'Check the preview of what was found.', 'Download the Excel file.'],
    faq: [
      ['Does it work with scanned receipts?', 'Yes. Scans are read with on-device OCR first.'],
      ['How is this different from PDF to Excel?', 'PDF to Excel converts a whole document. This tool picks out the data you need, like totals and line items, across many files at once.'],
    ],
    local: true,
  },
  'compare-pdf': {
    title: 'Compare PDF Free — See Changes Between Two Versions',
    h1: 'Compare two PDFs',
    desc: 'Spot every added and removed word, and see visual changes highlighted page by page. Compared on your device. Free.',
    intro: 'Check what changed between two versions of a contract, policy or design. See text changes word by word, or switch to visual mode to spot moved images and layout changes.',
    steps: ['Choose the old and new versions.', 'Review text changes, or switch to visual changes.', 'Swap the order any time.'],
    faq: [['Does it work with scans?', 'Visual mode works with any PDF. For text changes on scans, run OCR PDF on both first.']],
    local: true,
  },
  'add-page-numbers': {
    title: 'Add Page Numbers to PDF Free — Including Bates Numbering',
    h1: 'Add page numbers or Bates numbers',
    desc: 'Number every page, or stamp Bates numbers with your own prefix across many files. Processed on your device. Free.',
    intro: 'Add "Page 1 of 9" style numbers in any corner, skip the cover page, or apply legal Bates numbering that carries on across a whole batch of files.',
    steps: ['Choose one or more PDFs.', 'Pick the style and position.', 'Download the numbered files.'],
    faq: [['What is Bates numbering?', 'A unique, sequential number with a prefix (like ACME000123) stamped on every page of a document set, common in legal work.']],
    local: true,
  },
  'flatten-pdf': {
    title: 'Flatten PDF Free — Lock Form Fields',
    h1: 'Flatten a PDF',
    desc: 'Turn form fields and answers into regular page content so they print correctly and can\'t be edited. Free, on your device.',
    intro: 'Flattening locks filled-in form answers into the page. Use it before sending a completed form, or when fields don\'t print.',
    steps: ['Choose a PDF.', 'Flatten it.', 'Download the result.'],
    faq: [['Can I undo flattening?', 'No, keep your original if you may need to edit the answers later.']],
    local: true,
  },
  'pdf-to-png': {
    title: 'PDF to PNG Free — Lossless Page Images',
    h1: 'Convert PDF to PNG',
    desc: 'Save every PDF page as a sharp, lossless PNG image. Converted on your device. Free.',
    intro: 'PNG keeps text and lines crisp with no compression artefacts, ideal for slides, documentation and editing.',
    steps: ['Choose a PDF.', 'Convert it.', 'Download single images or a ZIP.'],
    faq: [['PNG or JPG?', 'PNG for text, diagrams and screenshots; JPG for photos and smaller files.']],
    local: true,
  },
  'pdf-to-pdfa': {
    title: 'PDF to PDF/A Free — Convert for Long-Term Archiving',
    h1: 'Convert PDF to PDF/A',
    desc: 'Convert a PDF to PDF/A-2b with embedded fonts and an sRGB colour profile, as required by many courts and archives. Files are deleted within 60 seconds. Free.',
    intro: 'PDF/A is the ISO standard for documents that must open exactly the same way decades from now. Many courts, governments and archives require it.',
    steps: ['Choose a PDF.', 'Convert it.', 'Download the PDF/A file.'],
    faq: [['Why does this use a server?', 'PDF/A conversion needs Ghostscript\'s full rendering engine. Your file is deleted within 60 seconds.']],
    local: false,
  },
  'html-to-pdf': {
    title: 'HTML to PDF Free — Convert Web Pages to PDF',
    h1: 'Convert HTML to PDF',
    desc: 'Turn saved web pages and HTML files into PDFs. Files are deleted within 60 seconds. Free.',
    intro: 'Convert an HTML file, such as a saved web page, email or report export, into a PDF you can share and print.',
    steps: ['Choose an .html file.', 'Convert it.', 'Download the PDF.'],
    faq: [['Can I paste a web address?', 'Not yet. Save the page as HTML in your browser (Ctrl+S) and convert the file.']],
    local: false,
  },
  'pdf-workflows': {
    title: 'PDF Workflows — Automate Compress, Number, Redact and Protect',
    h1: 'Automate your PDF routine',
    desc: 'Chain PDF tools into one-click workflows and run them on many files at once, all on your device. Free.',
    intro: 'Build a workflow such as "redact, watermark, then password-protect", save it, and run it on a whole batch of files in one go. Every step runs in your browser.',
    steps: ['Choose your PDFs.', 'Pick a preset or build your own list of steps.', 'Run it and download the results.'],
    faq: [
      ['Which steps can I use?', 'Compress, rotate, watermark, page numbers or Bates, flatten, OCR, smart redact, repair, crop and password-protect.'],
      ['Are my saved workflows private?', 'Yes. They are stored in your browser. Passwords are never saved.'],
    ],
    local: true,
  },
};

const PRIVACY_PAGE = {
  title: 'Private by Design — How LetsConvertPDF Keeps Your Files on Your Device',
  h1: 'Private by design',
  desc: 'Most LetsConvertPDF tools, including all AI features, run inside your browser. Your files are never uploaded. See exactly which tools run where.',
  intro: 'Most online PDF tools upload every file to their servers. LetsConvertPDF runs PDF processing and AI on your own device using WebAssembly and WebGPU, so your documents never leave your browser. Only Word, Excel and PowerPoint conversions use our server, and those files are deleted within 60 seconds.',
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function article(page, slug) {
  const steps = page.steps ? `<h2>How to use it</h2><ol>${page.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : '';
  const privacy = page.local === undefined ? '' : `<p><strong>Privacy:</strong> ${page.local ? LOCAL : SERVER}</p>`;
  const faq = page.faq ? `<h2>Questions</h2>${page.faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}` : '';
  const links = Object.entries(PAGES).filter(([s]) => s !== slug).map(([s, p]) => `<li><a href="/${s}">${esc(p.h1)}</a></li>`).join('');
  const guides = require('./guides').load(Object.keys(PAGES)).filter(g => g.tool === slug).slice(0, 5);
  const guideLinks = guides.length ? `<h2>Guides</h2><ul>${guides.map(g => `<li><a href="/guides/${g.slug}">${esc(g.title)}</a></li>`).join('')}</ul>` : '';
  return `<main style="max-width:720px;margin:0 auto;padding:96px 16px;font-family:system-ui,sans-serif;color:#E2E8F0">
<h1>${esc(page.h1)}</h1><p>${esc(page.intro)}</p>${steps}${privacy}${faq}${guideLinks}
<h2>More free, private PDF tools</h2><ul>${links}</ul><p><a href="/privacy">How we keep your files private</a></p></main>`;
}

function faqSchema(page) {
  if (!page.faq) return '';
  return `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: page.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  }).replace(/</g, '\\u003c')}</script>`;
}

/** Returns index.html personalised for `slug`, or null for unknown paths. */
function renderPage(html, slug) {
  const page = slug === 'privacy' ? PRIVACY_PAGE : PAGES[slug];
  if (!page) return null;
  const url = `${SITE}/${slug}`;
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(page.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(page.desc)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(page.title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(page.desc)}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(page.title)}$2`)
    .replace('</head>', `${faqSchema(page)}\n</head>`)
    .replace('<div id="root"></div>', `<div id="root">${article(page, slug)}</div>`);
}

function sitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const urls = ['', 'privacy', ...Object.keys(PAGES)].map(u => ({ loc: `${SITE}/${u}`, lastmod: today, priority: u === '' ? '1.0' : '0.8' }));
  urls.push(...require('./guides').sitemapEntries(PAGES).map(e => ({ ...e, lastmod: e.lastmod || today })));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u =>
    `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`).join('\n')}\n</urlset>\n`;
}

const robots = () => `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`;

module.exports = { PAGES, renderPage, sitemap, robots };
