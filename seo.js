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
    title: 'Edit PDF Free — Add Text to a PDF Online',
    h1: 'Add text to a PDF',
    desc: 'Add text to any page of a PDF. Edited in your browser, never uploaded. Free.',
    intro: 'Fill in blanks, add notes or correct details by placing text on any page.',
    steps: ['Choose a PDF.', 'Enter your text and where it goes.', 'Download the edited PDF.'],
    faq: [['Can I change existing text?', 'Not yet. You can add new text on top of the page.']],
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
  return `<main style="max-width:720px;margin:0 auto;padding:96px 16px;font-family:system-ui,sans-serif;color:#E2E8F0">
<h1>${esc(page.h1)}</h1><p>${esc(page.intro)}</p>${steps}${privacy}${faq}
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
  const urls = ['', 'privacy', ...Object.keys(PAGES)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u =>
    `  <url><loc>${SITE}/${u}</loc><lastmod>${today}</lastmod><priority>${u === '' ? '1.0' : '0.8'}</priority></url>`).join('\n')}\n</urlset>\n`;
}

const robots = () => `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`;

module.exports = { PAGES, renderPage, sitemap, robots };
