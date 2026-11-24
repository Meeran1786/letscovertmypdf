/* Who LetsConvertPDF is for, and the trust centre.
   One file, used twice: the browser reads window.LCP_AUDIENCES / LCP_TRUST to
   draw the pages, and seo.js require()s it to server-render the same text for
   search engines. Tool lists use the tool slugs from TOOLS in index.html.

   Only state what is true today. Certifications the company does not hold go
   in TRUST.roadmap with status 'planned', never as a badge. */
(function (root) {
  const GROUPS = [
    { id: 'everyday',  label: 'Students, individuals & small business', blurb: 'Everyday PDF work without handing your files to a stranger\'s server.' },
    { id: 'regulated', label: 'Legal, accounting & banking', blurb: 'Client files, financial statements and KYC documents that must not leak.' },
    { id: 'enterprise', label: 'Corporates', blurb: 'PDF tools your security team can approve, with verified sign-in for every user.' },
  ];

  const AUDIENCES = [
    {
      slug: 'pdf-tools-for-students', group: 'everyday', label: 'Students', icon: 'user',
      title: 'PDF Tools for Students — Private, On-Device AI for Notes and Papers',
      h1: 'PDF tools for students',
      desc: 'Summarise readings, chat with lecture notes, make scans searchable and merge assignments. Runs in your browser, so your work stays yours. 1,000 free credits every month.',
      intro: 'Readings, lecture slides, scanned handouts and assignment submissions: most of student life is PDFs. LetsConvertPDF handles them in your browser, and the AI that summarises and answers questions runs on your own device, so your notes and drafts are never uploaded.',
      needs: [
        ['Study faster', 'Get a summary of a 40-page reading, or ask a PDF a question and jump to the page the answer came from.'],
        ['Fix messy scans', 'Turn photographed or scanned handouts into searchable, selectable text, then compress them for upload limits.'],
        ['Submit in the right format', 'Merge chapters, convert images or Word files to PDF, and shrink files to fit a portal\'s size limit.'],
      ],
      tools: ['summarize-pdf', 'chat-with-pdf', 'ocr-pdf', 'merge-pdf', 'compress-pdf', 'jpg-to-pdf', 'word-to-pdf', 'translate-pdf'],
      faq: [
        ['Is there a student plan?', 'Every free account, students included, gets 1,000 credits each month after a Google sign-in. That is about 100 uses of the basic tools.'],
        ['Will my essay be uploaded or used to train an AI?', 'No. Summaries and chat run on your own device. Your file never reaches our servers, so it cannot be stored or used for training.'],
      ],
    },
    {
      slug: 'pdf-tools-for-individuals', group: 'everyday', label: 'Individuals', icon: 'file',
      title: 'Private PDF Tools for Personal Documents — IDs, Bills and Forms',
      h1: 'PDF tools for your personal documents',
      desc: 'Sign, fill, compress and protect personal PDFs such as IDs, bank statements and forms, without uploading them. Runs in your browser.',
      intro: 'Passport scans, bank statements, tax forms, rental agreements and medical letters are exactly the files you should not be uploading to a random website. Most LetsConvertPDF tools work on your device, so these files never leave it.',
      needs: [
        ['Fill and sign forms', 'Fill in PDF forms, add your signature and send them back, all in your browser.'],
        ['Share less', 'Black out account numbers properly, remove hidden metadata, and add a password before you email a file.'],
        ['Make files fit', 'Compress a PDF for an upload form, combine several photos into one PDF, or split out the one page you need.'],
      ],
      tools: ['fill-pdf-form', 'sign-pdf', 'redact-pdf', 'protect-pdf', 'compress-pdf', 'jpg-to-pdf', 'split-pdf', 'remove-pdf-metadata'],
      faq: [
        ['Is it safe to use for my ID or bank statement?', 'Tools with a green "On your device" badge never upload your file. Only the Word, Excel, PowerPoint, PDF/A and HTML converters use our server, and they delete files within 60 seconds.'],
        ['Do I need to install anything?', 'No. It works in any modern browser on a phone, tablet or computer, after a one-tap Google sign-in.'],
      ],
    },
    {
      slug: 'pdf-tools-for-small-business', group: 'everyday', label: 'Small business', icon: 'layers',
      title: 'PDF Tools for Small Business — Invoices, Contracts and Proposals',
      h1: 'PDF tools for small and medium businesses',
      desc: 'Pull invoice data into Excel, review contracts, sign, watermark and compress business PDFs. Files stay on your device. Business licences available.',
      intro: 'Small teams handle invoices, quotes, contracts and HR paperwork every day, usually without an IT department to vet tools. LetsConvertPDF keeps those files on the device that opened them and needs a verified Google account for every user.',
      needs: [
        ['Less data entry', 'Pull dates, totals and line items from invoices and receipts straight into an Excel sheet.'],
        ['Check before you sign', 'Flag risky clauses, missing blanks and unsigned pages in a contract, then sign it in place.'],
        ['Look professional', 'Add your logo as a watermark, headers and page numbers, and send files small enough for email.'],
      ],
      tools: ['pdf-data-to-excel', 'review-contract', 'sign-pdf', 'watermark-pdf', 'compress-pdf', 'pdf-to-word', 'add-header-footer-to-pdf', 'pdf-workflows'],
      faq: [
        ['Can my whole team use it?', 'Yes. Each person signs in with their own Google account. For unlimited use and team seats, see the Business plan on our Plans page.'],
        ['Does it work with Google Workspace accounts?', 'Yes. Sign-in is with Google, including Google Workspace accounts on your company domain.'],
      ],
    },
    {
      slug: 'pdf-tools-for-lawyers', group: 'regulated', label: 'Legal & law firms', icon: 'review',
      title: 'PDF Tools for Lawyers — Redaction, Bates Numbering and Contract Review',
      h1: 'PDF tools for lawyers and law firms',
      desc: 'Redact properly, add Bates numbers, compare drafts and review contracts in your browser. Client files are never uploaded to our servers.',
      intro: 'Privileged and confidential client documents should not pass through a free website\'s servers. Every legal-focused tool on LetsConvertPDF, including redaction, comparison and AI contract review, runs entirely on your own device.',
      needs: [
        ['Redact for real', 'Redacted pages are rebuilt so the text is really gone, not hidden under a black box, and metadata is cleared.'],
        ['Build bundles', 'Merge exhibits, add Bates numbers or page numbers, and flatten forms before filing.'],
        ['Track every change', 'Compare two drafts to see every text or visual change, and review a contract for risky clauses, blanks and missing signatures.'],
      ],
      tools: ['redact-pdf', 'add-page-numbers', 'compare-pdf', 'review-contract', 'merge-pdf', 'flatten-pdf', 'sign-pdf', 'pdf-workflows'],
      flows: ['Court bundle: merge, add Bates numbers and compress in one go.', 'Share confidentially: watermark, redact and password-protect.'],
      faq: [
        ['Does the AI contract review send my contract anywhere?', 'No. The review runs in your browser. The contract text never leaves your device.'],
        ['Can I prove a document was not changed?', 'You can compare any two versions to see every change. Tamper-evident receipts are on our roadmap for business accounts.'],
      ],
    },
    {
      slug: 'pdf-tools-for-accountants', group: 'regulated', label: 'Accountants, CAs & auditors', icon: 'table',
      title: 'PDF Tools for Accountants, CAs and Auditors — Private by Design',
      h1: 'PDF tools for accountants, CAs and auditors',
      desc: 'Pull tables and invoice data into Excel, OCR scanned statements and redact client details, all on your device. Built for accounting and audit firms.',
      intro: 'Accountants, chartered accountants and auditors work with balance sheets, ledgers, tax returns and client bank statements: some of the most sensitive files there are. LetsConvertPDF extracts, converts and redacts them on your own device.',
      needs: [
        ['From PDF to spreadsheet', 'Pull invoice and receipt fields into Excel, or convert statement tables for reconciliation.'],
        ['Work with scans', 'Make scanned statements and vouchers searchable so you can find any figure in seconds.'],
        ['Share working papers safely', 'Redact client identifiers, remove metadata, watermark drafts and protect files with a password.'],
      ],
      tools: ['pdf-data-to-excel', 'pdf-to-excel', 'ocr-pdf', 'redact-pdf', 'protect-pdf', 'watermark-pdf', 'compare-pdf', 'pdf-to-pdfa'],
      faq: [
        ['Which tools upload files?', 'Only PDF to Excel (the full converter), Word, PowerPoint, PDF/A and HTML conversions use our server, over HTTPS, and files are deleted within 60 seconds. Invoice and table extraction to Excel runs on your device.'],
        ['Can our firm get a licence?', 'Yes. Ask us about a business licence using the chat button, and we will set up seats for your team.'],
      ],
    },
    {
      slug: 'pdf-tools-for-banks', group: 'regulated', label: 'Banks & financial services', icon: 'lock',
      title: 'PDF Tools for Banks and Financial Services — On-Device Processing',
      h1: 'PDF tools for banks and financial services',
      desc: 'Handle KYC documents, loan files and statements without uploading them. On-device PDF processing, verified Google sign-in and no file retention.',
      intro: 'Banks, NBFCs, insurers and fintechs handle KYC documents, loan files and customer statements under strict data rules. Most LetsConvertPDF tools never send the file to any server, which removes the biggest risk of online PDF tools: a copy of customer data on someone else\'s machine.',
      needs: [
        ['Keep customer data on the device', 'Merge, split, compress, sign, redact and OCR without the file leaving the employee\'s computer.'],
        ['Mask before you share', 'Redact account and ID numbers properly and remove hidden metadata before files go outside the bank.'],
        ['Archive correctly', 'Convert records to PDF/A for long-term archiving, and flatten forms so they cannot be changed.'],
      ],
      tools: ['redact-pdf', 'ocr-pdf', 'merge-pdf', 'compress-pdf', 'sanitize-pdf', 'remove-pdf-metadata', 'flatten-pdf', 'pdf-to-pdfa'],
      faq: [
        ['Can we block tools that use a server?', 'A strict on-device-only policy for business licences is on our roadmap. Today, each tool is clearly badged "On your device" or "Secure server", and only office-format and PDF/A conversions use the server.'],
        ['Are you SOC 2 or ISO 27001 certified?', 'Not yet. Both are on our roadmap. Our trust page lists exactly what protects your files today.'],
      ],
    },
    {
      slug: 'pdf-tools-for-enterprise', group: 'enterprise', label: 'Corporates & enterprise', icon: 'protect',
      title: 'Enterprise PDF Tools — Private by Design, Verified Sign-In',
      h1: 'PDF tools for corporates and enterprises',
      desc: 'Give every employee PDF tools and private on-device AI without sending company files to a third party. Google Workspace sign-in and business licences.',
      intro: 'Employees will use free PDF websites whether IT approves or not, and each one may keep a copy of a confidential file. LetsConvertPDF gives them the same tools, with processing on their own device and a verified Google account behind every use.',
      needs: [
        ['Stop shadow uploads', 'Merging, compressing, signing and AI summaries happen on the employee\'s computer, so files do not leave the company.'],
        ['One sign-in', 'Users sign in with their Google Workspace account. No new passwords to manage or leak.'],
        ['Automate routines', 'Save multi-step workflows, such as watermark, redact and protect, and run them on many files at once.'],
      ],
      tools: ['pdf-workflows', 'chat-with-pdf', 'summarize-pdf', 'redact-pdf', 'compare-pdf', 'sign-pdf', 'protect-pdf', 'translate-pdf'],
      faq: [
        ['How is it licensed?', 'Business licences cover a number of seats for your team. Ask us using the chat button and we will send a quote and invoice.'],
        ['Can we self-host it?', 'A self-hosted licence is on our roadmap. Tell us through the chat button if you need it.'],
      ],
    },
  ];

  const TRUST = {
    slug: 'trust',
    title: 'Trust & Security — How LetsConvertPDF Protects Your Files',
    h1: 'Trust and security',
    desc: 'What protects your files on LetsConvertPDF today, which certifications we hold and which are on our roadmap. On-device processing, no file retention, Google-only sign-in.',
    intro: 'We would rather tell you exactly what we do than show you badges we have not earned. Here is what protects your files today, and where we are on formal certifications.',
    today: [
      ['lock', 'Most files never leave your device', 'Most of our tools, including every AI feature, run inside your browser. There is no upload, so there is no copy of your file on our servers.'],
      ['clock', 'No file retention', 'Office-format, PDF/A and HTML conversions run on our server over HTTPS, in a separate folder for each job. The upload is deleted as soon as the job ends and the result within 60 seconds.'],
      ['google', 'Verified sign-in only', 'Every account signs in with Google. We never see or store a password, and every use is tied to a real, verified account.'],
      ['eye', 'No file contents in our records', 'We record which tool was used, when, how many files and the credits it cost. Never the file, its name or its contents.'],
      ['protect', 'Hardened website', 'HTTPS everywhere, a strict Content Security Policy and other security headers, and rate limits against abuse and brute force.'],
      ['sparkle', 'Private AI', 'The AI model is downloaded once from Hugging Face\'s public library and runs on your device. Your document text is never sent to an AI provider.'],
    ],
    roadmap: [
      ['SOC 2 Type II', 'planned', 'Independent audit of our security controls. Not yet started.'],
      ['ISO/IEC 27001', 'planned', 'Certified information security management system. Not yet started.'],
      ['GDPR', 'aligned', 'We collect only your Google name and email, credit balance and a usage log without file details. A Data Processing Agreement for business customers is planned.'],
      ['India DPDP Act 2023', 'aligned', 'Same data-minimisation approach. A formal compliance review is planned.'],
      ['Independent penetration test', 'planned', 'Third-party security test of the website and server. Summary to be shared with business customers.'],
    ],
    verify: 'Open your browser\'s developer tools, go to the Network tab and use any tool with a green "On your device" badge. You will see no upload: the only request is a tiny one to pay its credits, carrying the tool name and number of files.',
    faq: [
      ['Are you SOC 2 or ISO 27001 certified?', 'Not yet. We will only show those badges once an independent auditor has certified us. Until then, this page lists the controls we do have.'],
      ['Can you fill in our vendor security questionnaire?', 'Yes. Send it through the chat button and we will answer it.'],
    ],
  };

  /* Plans (/pricing). Numbers match the server defaults; an admin can change
     the live numbers on /admin, so keep this text in step if they do. */
  const PRICING = {
    slug: 'pricing',
    title: 'Plans & Credits — Free, Pro and Business | LetsConvertPDF',
    h1: 'Plans and credits',
    desc: 'Free: 1,000 credits every month with Google sign-in. Pro: 10,000 credits a month and bigger files. Business: unlimited use, team seats and an audit log for banks, CAs and auditors.',
    intro: 'Every account signs in with Google and gets 1,000 free credits each month. Most tools cost 10 credits a use, so that is about 100 uses a month. Upgrade when you need more.',
    plans: [
      { id: 'free', name: 'Free', price: 'Free', tagline: 'For students and occasional use',
        features: ['1,000 credits every month', 'About 100 uses of basic tools', 'Files up to 25 MB', 'All 60+ tools, including on-device AI', 'Credits reset on the 1st, no rollover'] },
      { id: 'pro', name: 'Pro', price: 'Ask us', tagline: 'For freelancers and power users', highlight: true,
        features: ['10,000 credits every month', 'Files up to 200 MB', 'Batch processing and workflows on many files', 'Everything in Free', 'Invoice on request'] },
      { id: 'business', name: 'Business', price: 'Custom', tagline: 'For banks, CAs, accountants and auditors',
        features: ['Unlimited use for every seat', 'Files up to 500 MB', 'Team seats and company Google domain', 'Usage audit log without file contents', 'Invoice and a named contact'] },
    ],
    costs: [
      ['Basic tools', '10 credits', 'Merge, split, compress, convert, rotate, sign, protect, watermark and most others.'],
      ['Heavy tools', '25 credits', 'OCR, Chat with PDF, Summarize, Translate, Review contract, Invoices to Excel, Redact and Compare.'],
      ['Batches', 'Per file', 'Running a tool on 20 files costs 20 uses.'],
    ],
    faq: [
      ['Do unused credits roll over?', 'No. Your balance resets to your plan\'s monthly credits on the 1st of each month.'],
      ['Why do I need to sign in?', 'Every use is tied to a verified Google account. It keeps the service fair and lets businesses see who used what. Your files still stay on your device for most tools.'],
      ['How do I pay for Pro or Business?', 'Send a request from this page. We reply with an invoice and switch your plan on. Online card payment is coming later.'],
      ['What happens when I run out?', 'Tools stop until your credits reset on the 1st, or until you upgrade. Nothing you made is lost.'],
    ],
  };

  const out = { GROUPS, AUDIENCES, TRUST, PRICING };
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
  else { root.LCP_AUDIENCES = AUDIENCES; root.LCP_GROUPS = GROUPS; root.LCP_TRUST = TRUST; root.LCP_PRICING = PRICING; }
})(typeof window !== 'undefined' ? window : globalThis);
