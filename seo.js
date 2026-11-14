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
    desc: 'Ask questions about any PDF and get answers with page references. The AI runs in your browser, so your document is never uploaded. Free to start.',
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
      ['Which languages are supported?', 'English, Spanish, French, German, Portuguese, Italian, Dutch, Indonesian and Malay, Turkish and Polish. You can combine two languages for mixed documents.'],
      ['Will my PDF look different?', 'No. The text layer is invisible; the original page images are untouched.'],
    ],
    local: true,
  },
  'merge-pdf': {
    title: 'Merge PDF Free — Combine PDFs Without Uploading',
    h1: 'Merge PDF files',
    desc: 'Combine multiple PDFs into one file in the order you choose. Runs in your browser: files are never uploaded. Free to start.',
    intro: 'Put several PDFs together into a single document. Reorder the files before merging; pages keep their original quality.',
    steps: ['Choose two or more PDFs.', 'Use the arrows to put them in the order you want.', 'Merge and download one PDF.'],
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
    title: 'Translate PDF Free — Keep the Layout, Private and On-Device',
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
    title: 'Invoices and Receipts to Excel Free — Private PDF Extraction',
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
    title: 'PDF Workflows — Automate Compress, Redact and Protect',
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
  "extract-pdf-pages": {
    title: "Extract PDF Pages Free — Save Selected Pages, No Upload",
    h1: "Extract pages from a PDF",
    desc: "Pick the pages you need and save them as a new PDF. Runs in your browser, so your file is never uploaded. Free to start.",
    intro: "Need only a few pages from a long report, contract or textbook? Type the pages or ranges you want and get a new PDF with just those pages, in the order you choose.",
    steps: ["Choose a PDF.", "Type the pages to keep, for example 1-3, 5, 8-.", "Download your new PDF."],
    faq: [["Can I change the page order?", "Yes. Pages come out in the order you type them, so 5, 1-3 puts page 5 first."], ["Is the quality reduced?", "No. Pages are copied exactly as they are, including text, links and images."]],
    local: true,
  },
  "delete-pdf-pages": {
    title: "Delete PDF Pages Free — Remove Pages Without Uploading",
    h1: "Delete pages from a PDF",
    desc: "Remove unwanted pages from a PDF in seconds. Works in your browser with no upload.",
    intro: "Remove cover sheets, blank pages, ads or anything else you don't need. Everything else stays exactly as it was.",
    steps: ["Choose a PDF.", "Type the pages to delete, for example 2, 4-6.", "Download the shorter PDF."],
    faq: [["Can I undo it?", "Your original file is never changed. You download a new copy without those pages."]],
    local: true,
  },
  "remove-blank-pages": {
    title: "Remove Blank Pages from PDF Free — Automatic, Private",
    h1: "Remove blank pages from a PDF",
    desc: "Automatically find and delete empty pages from scanned PDFs. Runs on your device; nothing is uploaded. Free to start.",
    intro: "Scanners often add empty backs of single-sided pages. This tool looks at every page on your device and removes the ones with no visible content.",
    steps: ["Choose a PDF.", "We check each page for content.", "Download the PDF without blank pages."],
    faq: [["What counts as blank?", "A page where almost nothing is printed. Pages with a faint mark, a page number or a few words are kept."], ["Can I run it on many files?", "Yes. Add several PDFs and each is cleaned the same way."]],
    local: true,
  },
  "add-blank-page-to-pdf": {
    title: "Add Blank Page to PDF Free — Insert Empty Pages",
    h1: "Add blank pages to a PDF",
    desc: "Insert one or more empty pages anywhere in a PDF. Free, private and runs in your browser.",
    intro: "Add space for notes, make page counts even for double-sided printing, or separate sections with an empty page.",
    steps: ["Choose a PDF.", "Choose where to insert and how many pages.", "Download your PDF."],
    faq: [["What size are the blank pages?", "The same size as the page right before them."]],
    local: true,
  },
  "reverse-pdf": {
    title: "Reverse PDF Page Order Free — Online, No Upload",
    h1: "Reverse the page order of a PDF",
    desc: "Flip a PDF so the last page comes first. Ideal for back-to-front scans. Free to start and private.",
    intro: "Scanned a stack upside down or back to front? Reverse it in one click without re-scanning.",
    steps: ["Choose a PDF.", "Click Reverse Pages.", "Download the reversed PDF."],
    local: true,
  },
  "n-up-pdf": {
    title: "N-up PDF Free — Print 2, 4, 6 or 9 Pages per Sheet",
    h1: "Put several pages on one sheet",
    desc: "Combine 2, 4, 6 or 9 PDF pages onto each sheet to save paper when printing handouts and slides. Free and private.",
    intro: "Print lecture slides, handouts and drafts on fewer sheets. Pages are scaled to fit and arranged in reading order.",
    steps: ["Choose a PDF.", "Pick how many pages per sheet.", "Download and print."],
    faq: [["Is the text still sharp?", "Yes. Pages are placed as vectors, not images, so text stays crisp at any zoom."]],
    local: true,
  },
  "pdf-booklet": {
    title: "Make a PDF Booklet Free — Print, Fold and Staple",
    h1: "Make a booklet from a PDF",
    desc: "Rearrange PDF pages into booklet order so you can print double-sided, fold and staple. Free, runs in your browser.",
    intro: "Turn any PDF into a printable booklet for zines, programmes, menus and manuals. We handle the tricky page order for you.",
    steps: ["Choose a PDF.", "Click Make Booklet.", "Print double-sided, flipping on the short edge, then fold."],
    faq: [["What if my page count isn't a multiple of four?", "Blank pages are added at the end so the booklet folds correctly."]],
    local: true,
  },
  "alternate-mix-pdf": {
    title: "Alternate and Mix PDF Pages Free — Combine Duplex Scans",
    h1: "Alternate and mix PDF pages",
    desc: "Interleave pages from two PDFs: front sides and back sides of a scan become one document. Free, private, no upload.",
    intro: "Scanned all the fronts, then all the backs? Mix them back into the right order, with an option to reverse the backs.",
    steps: ["Choose two PDFs.", "Tick \"reverse the second file\" if the backs were scanned last to first.", "Download the combined PDF."],
    faq: [["Can I mix more than two files?", "Yes. Pages are taken one from each file in turn."]],
    local: true,
  },
  "add-header-footer-to-pdf": {
    title: "Add Header and Footer to PDF Free — Page X of Y, Dates",
    h1: "Add a header and footer to a PDF",
    desc: "Add text, dates, file names and \"Page 1 of 10\" to the top or bottom of every PDF page. Free and runs in your browser.",
    intro: "Put a company name, confidentiality notice, date or page count on every page, aligned left, centre or right.",
    steps: ["Choose a PDF.", "Type the header or footer text. Use {page}, {total}, {date} or {file}.", "Download your PDF."],
    local: true,
  },
  "remove-pdf-annotations": {
    title: "Remove PDF Annotations Free — Delete Comments and Highlights",
    h1: "Remove comments and highlights from a PDF",
    desc: "Strip comments, highlights, sticky notes and markups from a PDF while keeping form fields. Free and private.",
    intro: "Send a clean copy without your review notes. Comments, highlights, drawings and stamps are removed; the page content stays.",
    steps: ["Choose a PDF.", "Click Remove Annotations.", "Download the clean PDF."],
    local: true,
  },
  "pdf-to-text": {
    title: "PDF to Text Free — Convert PDF to TXT Without Uploading",
    h1: "Convert PDF to text",
    desc: "Extract all the text from a PDF into a plain .txt file. Runs on your device. Free to start.",
    intro: "Get the words out of any PDF for editing, searching, or pasting somewhere else. Each page is labelled so you can find your place.",
    steps: ["Choose a PDF.", "Click PDF to Text.", "Download the .txt file."],
    faq: [["Does it work on scans?", "Scans are images of text. Run OCR PDF first, then convert to text."]],
    local: true,
  },
  "pdf-to-markdown": {
    title: "PDF to Markdown Free — Convert PDF to MD for Notes and AI",
    h1: "Convert PDF to Markdown",
    desc: "Turn a PDF into clean Markdown with headings, lists and paragraphs. Works in your browser; nothing is uploaded.",
    intro: "Bring PDFs into Obsidian, Notion, GitHub, docs sites or AI tools. We rebuild headings from font sizes and keep bullet and numbered lists.",
    steps: ["Choose a PDF.", "Click PDF to Markdown.", "Download the .md file."],
    faq: [["Are tables kept?", "Table text is kept as paragraphs. Use Invoices to Excel for tables."]],
    local: true,
  },
  "extract-images-from-pdf": {
    title: "Extract Images from PDF Free — Save Every Picture as PNG",
    h1: "Extract images from a PDF",
    desc: "Save every photo and picture embedded in a PDF at its original resolution. Free, private, runs in your browser.",
    intro: "Get the original pictures out of brochures, reports and catalogues without screenshots or quality loss.",
    steps: ["Choose a PDF.", "We find every embedded image.", "Download them one by one or as a ZIP."],
    faq: [["How is this different from PDF to JPG?", "PDF to JPG saves whole pages. This saves only the pictures inside them."]],
    local: true,
  },
  "pdf-to-webp": {
    title: "PDF to WebP Free — Convert PDF Pages to WebP Images",
    h1: "Convert PDF to WebP",
    desc: "Save each PDF page as a WebP image: smaller than JPG and PNG at the same quality. Free and private.",
    intro: "WebP images load fast on websites and in apps. Pick the quality and download every page.",
    steps: ["Choose a PDF.", "Pick a quality.", "Download the images."],
    local: true,
  },
  "png-to-pdf": {
    title: "PNG to PDF Free — Convert PNG Images to PDF, No Upload",
    h1: "Convert PNG to PDF",
    desc: "Combine one or more PNG images into a single PDF. Runs in your browser, so your images are never uploaded. Free to start.",
    intro: "Turn screenshots, scans and graphics into one PDF that is easy to share and print. Reorder the images before converting.",
    steps: ["Choose your PNG images.", "Put them in order.", "Download your PDF."],
    local: true,
  },
  "webp-to-pdf": {
    title: "WebP to PDF Free — Convert WebP Images to PDF",
    h1: "Convert WebP to PDF",
    desc: "Convert WebP images to PDF in your browser. Combine several into one file. Free to start and private.",
    intro: "Saved images from the web as WebP? Turn them into a PDF anyone can open.",
    steps: ["Choose your WebP images.", "Put them in order.", "Download your PDF."],
    local: true,
  },
  "svg-to-pdf": {
    title: "SVG to PDF Free — Convert SVG Logos and Drawings to PDF",
    h1: "Convert SVG to PDF",
    desc: "Convert SVG files to PDF at high resolution, right in your browser. Free and private.",
    intro: "Turn logos, icons, diagrams and drawings into PDFs for printing or sharing. Each SVG becomes one page at its own size.",
    steps: ["Choose one or more SVG files.", "Click SVG to PDF.", "Download your PDF."],
    local: true,
  },
  "text-to-pdf": {
    title: "Text to PDF Free — Convert TXT Files to PDF",
    h1: "Convert text to PDF",
    desc: "Turn .txt, log, CSV and code files into tidy, paginated PDFs. Runs in your browser. Free to start.",
    intro: "Long text files are hard to share and print. Get clean A4 pages with word wrap; code and logs use a fixed-width font.",
    steps: ["Choose a text file.", "Click Text to PDF.", "Download your PDF."],
    faq: [["Which languages work?", "Latin-alphabet text today. Other scripts are shown as \"?\" for now."]],
    local: true,
  },
  "markdown-to-pdf": {
    title: "Markdown to PDF Free — Convert MD to PDF Online",
    h1: "Convert Markdown to PDF",
    desc: "Convert Markdown files to PDF with headings, lists, quotes and code blocks. Free, private, in your browser.",
    intro: "Share README files, notes and docs as PDFs without installing anything.",
    steps: ["Choose a .md file.", "Click Markdown to PDF.", "Download your PDF."],
    local: true,
  },
  "pdf-to-grayscale": {
    title: "PDF to Grayscale Free — Convert PDF to Black and White",
    h1: "Convert a PDF to greyscale",
    desc: "Turn colour PDF pages into black and white for cheaper printing. Runs on your device. Free, no upload.",
    intro: "Save colour ink and meet print-shop or court filing rules by converting every page to shades of grey.",
    steps: ["Choose a PDF.", "Click PDF to Greyscale.", "Download the greyscale PDF."],
    faq: [["Can I still select the text?", "Pages become images. Run OCR PDF afterwards to make them searchable again."]],
    local: true,
  },
  "resize-pdf": {
    title: "Resize PDF Pages Free — Change PDF to A4, Letter or Legal",
    h1: "Resize PDF pages",
    desc: "Fit every page of a PDF to A4, Letter, Legal, A3 or A5. Content is scaled and centred. Free, private.",
    intro: "Mixed page sizes, or a US Letter document that must be A4? Make every page the same size in one step.",
    steps: ["Choose a PDF.", "Pick a paper size.", "Download the resized PDF."],
    faq: [["Does it change the file size in MB?", "Only slightly. To make the file smaller, use Compress PDF."]],
    local: true,
  },
  "linearize-pdf": {
    title: "Linearize PDF Free — Fast Web View Optimisation",
    h1: "Optimise a PDF for fast web view",
    desc: "Linearize a PDF so the first page opens while the rest downloads. Runs on your device with qpdf. Free.",
    intro: "Large PDFs on websites can take ages to appear. A linearized file shows the first page straight away.",
    steps: ["Choose a PDF.", "Click Fast Web View.", "Upload the new file to your website."],
    local: true,
  },
  "edit-pdf-metadata": {
    title: "Edit PDF Metadata Free — Change Title, Author and Keywords",
    h1: "Edit PDF metadata",
    desc: "Change a PDF's title, author, subject and keywords in your browser. Free to start and private.",
    intro: "The title shows in browser tabs and search results, and the author shows in file properties. Set them properly before you publish.",
    steps: ["Choose a PDF.", "Edit the fields.", "Download your PDF."],
    local: true,
  },
  "remove-pdf-metadata": {
    title: "Remove PDF Metadata Free — Strip Author and Hidden Info",
    h1: "Remove metadata from a PDF",
    desc: "Delete the author, dates, software names and hidden XMP data from a PDF before sharing. Runs on your device.",
    intro: "PDFs often carry your name, your company, the software you used and when you edited them. Remove it all in one click.",
    steps: ["Choose a PDF.", "Click Remove Metadata.", "Download the clean PDF."],
    local: true,
  },
  "sanitize-pdf": {
    title: "Sanitize PDF Free — Remove JavaScript and Hidden Content",
    h1: "Sanitize a PDF",
    desc: "Remove JavaScript, auto-run actions, embedded files and metadata from a PDF. Free and runs on your device.",
    intro: "PDFs can carry scripts and hidden attachments. Sanitize a file before you share it, or before opening one you don't trust.",
    steps: ["Choose a PDF.", "Click Sanitize PDF.", "Download the safe copy."],
    faq: [["Does it change how the pages look?", "No. Only scripts, actions, attachments and metadata are removed."]],
    local: true,
  },
};

const PRIVACY_PAGE = {
  title: 'Private by Design — How LetsConvertPDF Keeps Your Files on Your Device',
  h1: 'Private by design',
  desc: 'Most LetsConvertPDF tools, including all AI features, run inside your browser. Your files are never uploaded. See exactly which tools run where.',
  intro: 'Most online PDF tools upload every file to their servers. LetsConvertPDF runs PDF processing and AI on your own device using WebAssembly and WebGPU, so your documents never leave your browser. Only Word, Excel, PowerPoint, PDF/A and HTML conversions use our server, and those files are deleted within 60 seconds.',
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

/* The home page's WebApplication block, re-described for this one tool, so AI
   answer engines can tell what each page does, that it's free and where it runs. */
function toolSchema(page, url) {
  return `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'WebApplication', name: page.h1, url, description: page.desc,
    applicationCategory: 'UtilitiesApplication', operatingSystem: 'Web Browser', isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    ...(page.local !== undefined && { featureList: [page.local ? LOCAL : SERVER] }),
    isPartOf: { '@type': 'WebSite', name: 'LetsConvertPDF', url: SITE },
    creator: { '@type': 'Organization', name: 'Maqsusi Digital Industries Software', url: 'https://maqsusi.com' },
  }).replace(/</g, '\\u003c')}</script>`;
}

const i18n = require('./i18n');

/** slug → tool id, read from the TOOLS list in index.html (the single source). */
let slugIds = null;
function toolIdFor(html, slug) {
  if (!slugIds) { slugIds = {}; for (const m of html.matchAll(/\{ id:'([a-z0-9]+)',\s*slug:'([a-z0-9-]+)'/g)) slugIds[m[2]] = m[1]; }
  return slugIds[slug];
}

/** <link rel="alternate" hreflang> for every language version of `slug` ('' = home). */
function alternates(slug) {
  const tail = slug ? `/${slug}` : '/';
  return i18n.LANGS.map(l => `<link rel="alternate" hreflang="${l}" href="${SITE}${l === 'en' ? '' : '/' + l}${l === 'en' ? tail : (slug ? tail : '')}" />`).join('\n')
    + `\n<link rel="alternate" hreflang="x-default" href="${SITE}${tail}" />`;
}

/** BreadcrumbList (Home › Tool) so results show the site name and path, not a bare URL. */
function crumbs(name, url, lang = 'en') {
  const home = lang === 'en' ? `${SITE}/` : `${SITE}/${lang}`;
  return `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'LetsConvertPDF', item: home },
      { '@type': 'ListItem', position: 2, name, item: url }],
  }).replace(/</g, '\\u003c')}</script>`;
}

/** Sets <html lang/dir> and hands the page its language pack (only that one). */
function injectLang(html, lang) {
  if (!i18n.has(lang)) return html;
  const dict = JSON.stringify(i18n.DICT[lang]).replace(/</g, '\\u003c');
  return html
    .replace(/<html lang="en"/, `<html lang="${lang}"${i18n.RTL.has(lang) ? ' dir="rtl"' : ''}`)
    .replace('<head>', `<head>\n  <script>window.LCP_LANG=${JSON.stringify(lang)};window.LCP_I18N=${dict};</script>`);
}

/** A tool page in another language, built from the translated label and description. */
function localPage(html, slug, lang) {
  const base = PAGES[slug]; const id = toolIdFor(html, slug); const tr = id && i18n.tool(lang, id);
  if (!base || !tr) return null;
  const [label, desc] = tr; const u = (k, f) => i18n.ui(lang, k, f);
  return {
    title: u('seo.title', '{tool}').replace('{tool}', label), h1: label,
    desc: `${desc} ${u('seo.free', '')}`.trim(), intro: desc,
    steps: [u('seo.step1', ''), u('seo.step2', ''), u('seo.step3', '')], local: base.local, lang,
  };
}

function localArticle(html, page, slug, lang) {
  const u = (k, f) => i18n.ui(lang, k, f);
  const links = Object.keys(PAGES).filter(s => s !== slug).map(s => { const id = toolIdFor(html, s); const tr = id && i18n.tool(lang, id); return tr ? `<li><a href="/${lang}/${s}">${esc(tr[0])}</a></li>` : ''; }).join('');
  return `<main style="max-width:720px;margin:0 auto;padding:96px 16px;font-family:system-ui,sans-serif;color:#E2E8F0">
<h1>${esc(page.h1)}</h1><p>${esc(page.intro)}</p><h2>${esc(u('seo.howto', 'How to use it'))}</h2><ol>${page.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
<p><strong>${esc(u('seo.privacy', 'Privacy'))}:</strong> ${esc(page.local ? u('seo.local', LOCAL) : u('seo.server', SERVER))}</p>
<h2>${esc(u('seo.more', 'More free, private PDF tools'))}</h2><ul>${links}</ul></main>`;
}

function setHead(html, { title, desc, url }) {
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(title)}$2`);
}

/** The home page in `lang` ('en' adds only the hreflang links). */
function renderHome(html, lang = 'en') {
  if (lang === 'en') return html.replace('</head>', `${alternates('')}\n</head>`);
  if (!i18n.has(lang)) return null;
  const out = setHead(html, { title: i18n.ui(lang, 'home.title', ''), desc: i18n.ui(lang, 'home.desc', ''), url: `${SITE}/${lang}` });
  return injectLang(out.replace('</head>', `${alternates('')}\n</head>`), lang);
}

/** Returns index.html personalised for `slug` (in `lang`), or null for unknown paths. */
function renderPage(html, slug, lang = 'en') {
  if (lang !== 'en') {
    if (!i18n.has(lang)) return null;
    if (slug === 'privacy') return injectLang(renderPage(html, slug), lang);
    const page = localPage(html, slug, lang);
    if (!page) return null;
    const url = `${SITE}/${lang}/${slug}`;
    const out = setHead(html, { title: page.title, desc: page.desc, url })
      .replace(/<script type="application\/ld\+json">\{"@context":"https:\/\/schema.org","@type":"WebApplication"[^<]*<\/script>/, toolSchema({ ...page, local: undefined }, url))
      .replace('</head>', `${crumbs(page.h1, url, lang)}\n${alternates(slug)}\n</head>`)
      .replace('<div id="root"></div>', `<div id="root">${localArticle(html, page, slug, lang)}</div>`);
    return injectLang(out, lang);
  }
  const page = slug === 'privacy' ? PRIVACY_PAGE : PAGES[slug];
  if (!page) return null;
  const url = `${SITE}/${slug}`;
  return setHead(html, { title: page.title, desc: page.desc, url })
    .replace(/<script type="application\/ld\+json">\{"@context":"https:\/\/schema.org","@type":"WebApplication"[^<]*<\/script>/, page.h1 && page.steps ? toolSchema(page, url) : '$&')
    .replace('</head>', `${faqSchema(page)}\n${crumbs(page.h1, url)}\n${slug === 'privacy' ? '' : alternates(slug)}\n</head>`)
    .replace('<div id="root"></div>', `<div id="root">${article(page, slug)}</div>`);
}

let builtOn = null;
function contentDate() {
  if (!builtOn) {
    const fs = require('fs'), path = require('path');
    const files = [path.join(__dirname, 'public', 'index.html'), __filename,
      ...fs.readdirSync(path.join(__dirname, 'i18n')).map(f => path.join(__dirname, 'i18n', f))];
    const newest = Math.max(...files.map(f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }));
    builtOn = new Date(newest || Date.now()).toISOString().slice(0, 10);
  }
  return builtOn;
}

function sitemapUrls() {
  // lastmod is the day the page content last changed (newest of the files the
  // pages are built from), not "today": Bing and Google ignore a lastmod that
  // changes on every fetch, and IndexNow re-sends pages only when it changes.
  const today = contentDate();
  const urls = ['', 'privacy', ...Object.keys(PAGES)].map(u => ({ loc: `${SITE}/${u}`, lastmod: today, priority: u === '' ? '1.0' : '0.8' }));
  for (const l of i18n.LANGS.slice(1)) {
    urls.push({ loc: `${SITE}/${l}`, lastmod: today, priority: '0.9' });
    for (const slug of Object.keys(PAGES)) urls.push({ loc: `${SITE}/${l}/${slug}`, lastmod: today, priority: '0.7' });
  }
  urls.push(...require('./guides').sitemapEntries(PAGES).map(e => ({ ...e, lastmod: e.lastmod || today })));
  return urls;
}

function sitemap() {
  const urls = sitemapUrls();
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u =>
    `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`).join('\n')}\n</urlset>\n`;
}

/* llms.txt (https://llmstxt.org): a plain Markdown map of the site for AI
   assistants and answer engines. Built from the same data as the pages. */
function llmsTxt() {
  const guides = require('./guides').load(Object.keys(PAGES));
  const tool = ([slug, p]) => `- [${p.h1}](${SITE}/${slug}): ${p.desc}`;
  const local = Object.entries(PAGES).filter(([, p]) => p.local), server = Object.entries(PAGES).filter(([, p]) => !p.local);
  return `# LetsConvertPDF

> Private PDF tools that run in your web browser. Most tools, including all AI features (chat with a PDF, summaries, translation, contract review), process files on the user's own device, so the files are never uploaded. Sign-in is with Google only, so every user is verified; new accounts get 1,000 free credits and each use costs 5. There are no watermarks.

- Private by design: ${PRIVACY_PAGE.intro}
- Works on phones, tablets and computers in any modern browser, and can be installed as an app.
- Also written as Lets Convert PDF or Let's Convert PDF. Website: https://letsconvertpdf.com
- Made by Maqsusi Digital Industries Software.

## Tools that run on your device (files are never uploaded)

${local.map(tool).join('\n')}

## Tools that use our server (files deleted within 60 seconds)

${server.map(tool).join('\n')}
${guides.length ? `
## Guides

${guides.map(g => `- [${g.title}](${SITE}/guides/${g.slug}): ${g.description}`).join('\n')}
` : ''}
## Optional

- [How we keep files private](${SITE}/privacy)
- [All guides](${SITE}/guides)
- [Sitemap](${SITE}/sitemap.xml)
`;
}

const robots = () => `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\n\nSitemap: ${SITE}/sitemap.xml\n`;

module.exports = { PAGES, SITE, renderPage, renderHome, sitemap, sitemapUrls, robots, llmsTxt };
