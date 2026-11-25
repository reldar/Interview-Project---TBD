import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PAGE_W = 612;
const PAGE_H = 792;

function escapePdfText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function textCmd(x, y, size, text, { bold = false, color = '0 0 0' } = {}) {
  const font = bold ? '/F2' : '/F1';
  return `${color} rg BT ${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapePdfText(text)}) Tj ET`;
}

function rectCmd(x, y, w, h, { fill, stroke, lineWidth = 0.75 } = {}) {
  const parts = [];
  if (fill) parts.push(`${fill} rg ${x} ${y} ${w} ${h} re f`);
  if (stroke) parts.push(`${lineWidth} w ${stroke} RG ${x} ${y} ${w} ${h} re S`);
  return parts.join('\n');
}

function lineCmd(x1, y1, x2, y2, { stroke = '0.75 0.78 0.82', lineWidth = 0.75 } = {}) {
  return `${lineWidth} w ${stroke} RG ${x1} ${y1} m ${x2} ${y2} l S`;
}

function buildPdf(pages) {
  // Objects: 1=Catalog, 2=Pages, 3=Font F1, 4=Font F2, then (Page, Contents) pairs.
  const pageCount = pages.length;
  const pageIds = [];
  const objects = [
    null, // 1: Catalog (filled below)
    null, // 2: Pages (filled below)
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];

  for (let i = 0; i < pageCount; i += 1) {
    const pageObjId = objects.length + 1;
    const contentObjId = objects.length + 2;
    pageIds.push(`${pageObjId} 0 R`);
    const stream = pages[i].join('\n');
    const len = Buffer.byteLength(stream, 'utf8');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>`
    );
    objects.push(`<< /Length ${len} >>\nstream\n${stream}\nendstream`);
  }

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Count ${pageCount} /Kids [${pageIds.join(' ')}] >>`;

  return serializePdfObjects(objects);
}

function serializePdfObjects(objects, trailerExtra = '') {
  let out = '%PDF-1.4\n';
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 0; i < objects.length; i += 1) {
    xref += `${String(Buffer.byteLength(out, 'utf8')).padStart(10, '0')} 00000 n \n`;
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const startxref = Buffer.byteLength(out, 'utf8');
  out += `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(out, 'utf8');
}

function buildSectionLines(cmds, x, startY, heading, lines, { gap = 14, headingGap = 16, width = 504 } = {}) {
  let y = startY;
  cmds.push(textCmd(x, y, 11, heading, { bold: true, color: '0.1 0.16 0.28' }));
  y -= 4;
  cmds.push(lineCmd(x, y, x + width, y));
  y -= headingGap;
  for (const line of lines) {
    const isSubhead = typeof line === 'object';
    const text = isSubhead ? line.text : line;
    const bold = isSubhead ? Boolean(line.bold) : false;
    const size = isSubhead && line.size ? line.size : 9.5;
    cmds.push(textCmd(x, y, size, text, { bold }));
    y -= gap;
  }
  return y;
}

function createReadableSpecs() {
  return [
    {
      id: '01-single-column',
      filename: '01-single-column.pdf',
      layout: 'single-column',
      language: 'en',
      expectedSkills: ['Python', 'Excel', 'SQL'],
      expectedBullets: [
        '- Built a Python script to clean duplicate rows from weekly intake files.',
        '- Helped prepare weekly operations reports in Excel for team leads.',
        '- Wrote step-by-step instructions for preparing recurring reports.',
        '- Queried order status tables in SQL to flag delayed shipments.',
      ],
      syntheticPii: [
        'sample.candidate01@example.com',
        '+62 812-3456-7890',
        'Home Address: Jl. Melati No. 12, Kebayoran Baru, Jakarta Selatan 12160',
      ],
      survivingLandmarks: ['Data Analyst Intern', 'Jan 2023 - Dec 2024', 'Graduated 2024'],
      expectedPages: 1,
      sampleJobDescription:
        'Data Analyst Intern. Required skills: Python, Excel, SQL, and Tableau. Support reporting and data cleanup.',
      buildPages() {
        const c = [];
        c.push(textCmd(54, 742, 18, 'Nadia Putri', { bold: true }));
        c.push(textCmd(54, 724, 10, 'Data Analyst Intern | Jakarta | sample.candidate01@example.com | +62 812-3456-7890'));
        c.push(textCmd(54, 709, 9.5, 'Home Address: Jl. Melati No. 12, Kebayoran Baru, Jakarta Selatan 12160'));

        let y = buildSectionLines(c, 54, 678, 'SUMMARY', [
          'Recent statistics graduate focused on structured data cleanup, spreadsheet modeling, and reporting.',
        ]);
        y = buildSectionLines(c, 54, y - 6, 'SKILLS', ['Technical Skills: Python, Excel, SQL']);
        y = buildSectionLines(c, 54, y - 6, 'EXPERIENCE', [
          { text: 'Data Analyst Intern - PT Data Fiktif Nusantara (Jan 2023 - Dec 2024)', bold: true },
          '- Built a Python script to clean duplicate rows from weekly intake files.',
          '- Helped prepare weekly operations reports in Excel for team leads.',
          '- Wrote step-by-step instructions for preparing recurring reports.',
          '- Queried order status tables in SQL to flag delayed shipments.',
        ]);
        buildSectionLines(c, 54, y - 6, 'EDUCATION', [
          { text: 'Universitas Nusantara - B.Sc. Statistics (Graduated 2024)', bold: true },
          'Relevant coursework: Database Systems, Applied Regression, Data Visualization.',
        ]);
        return [c];
      },
    },
    {
      id: '02-two-column',
      filename: '02-two-column.pdf',
      layout: 'two-column',
      language: 'en',
      expectedSkills: ['Python', 'SQL', 'Tableau', 'Excel'],
      expectedBullets: [
        '- Built SQL views to reconcile monthly invoice exports.',
        '- Automated CSV cleanup scripts using Python.',
        '- Created weekly operational dashboards in Tableau.',
        '- Prepared handoff notes for Excel inventory audits.',
      ],
      syntheticPii: [
        'sample.candidate02@example.com',
        'Phone: +62 813-4567-8901',
        'DOB: 14 August 2001',
      ],
      survivingLandmarks: ['Junior Data Engineer', 'Mar 2023 - Nov 2024', 'Graduated 2023'],
      expectedPages: 1,
      sampleJobDescription:
        'Junior Data Engineer. Must know Python, SQL, Tableau, Excel, and Apache Airflow.',
      buildPages() {
        const c = [];
        c.push(rectCmd(0, 696, PAGE_W, 96, { fill: '0.94 0.96 0.99' }));
        c.push(textCmd(48, 750, 18, 'Bima Pratama', { bold: true }));
        c.push(textCmd(48, 730, 11, 'Junior Data Engineer'));
        c.push(textCmd(48, 712, 9.5, 'sample.candidate02@example.com | Phone: +62 813-4567-8901 | DOB: 14 August 2001'));
        c.push(lineCmd(294, 675, 294, 80));

        // Left column emitted top-to-bottom
        let ly = buildSectionLines(c, 48, 668, 'SKILLS', [
          'Core: Python, SQL, Tableau, Excel',
          'Workflows: CSV validation, ETL scripts',
        ], { width: 226 });
        ly = buildSectionLines(c, 48, ly - 10, 'EDUCATION', [
          { text: 'Institut Teknologi Fiktif', bold: true },
          'B.Eng. Informatics (Graduated 2023)',
          'GPA: 3.72/4.00',
        ], { width: 226 });
        buildSectionLines(c, 48, ly - 10, 'CERTIFICATIONS', [
          'SQL Analytics Track',
          'Python Data Processing Workshop',
        ], { width: 226 });

        // Right column emitted top-to-bottom
        let ry = buildSectionLines(c, 312, 668, 'EXPERIENCE', [
          { text: 'Junior Data Engineer (Mar 2023 - Nov 2024)', bold: true },
          'PT Sinar Logistik Fiktif',
          '- Built SQL views to reconcile monthly invoice exports.',
          '- Automated CSV cleanup scripts using Python.',
          '- Created weekly operational dashboards in Tableau.',
          '- Prepared handoff notes for Excel inventory audits.',
        ], { width: 256 });
        buildSectionLines(c, 312, ry - 10, 'HIGHLIGHTS', [
          'Maintained clean reporting schemas for 3 regional teams.',
        ], { width: 256 });
        return [c];
      },
    },
    {
      id: '03-sidebar',
      filename: '03-sidebar.pdf',
      layout: 'sidebar',
      language: 'en',
      expectedSkills: ['Excel', 'SQL', 'Tableau'],
      expectedBullets: [
        '- Maintained weekly supplier tracking sheets in Excel.',
        '- Extracted fulfillment backlog records using SQL.',
        '- Built service-level summary views in Tableau.',
        '- Coordinated shift handoff checklists with warehouse supervisors.',
      ],
      syntheticPii: [
        'sample.candidate03@example.com',
        'WA: 0812-2345-6789',
        'Address: Jl. Anggrek No. 8, Bandung 40115',
      ],
      survivingLandmarks: ['Business Operations Intern', 'Jun 2023 - Dec 2024', 'Graduated 2024'],
      expectedPages: 1,
      sampleJobDescription:
        'Business Operations Analyst. Required: Excel, SQL, Tableau, and Power BI.',
      buildPages() {
        const c = [];
        c.push(rectCmd(0, 0, 190, PAGE_H, { fill: '0.92 0.94 0.97' }));
        // Left sidebar
        c.push(textCmd(22, 742, 15, 'Siti Rahma', { bold: true }));
        c.push(textCmd(22, 725, 9.5, 'Business Operations Intern'));
        let sy = buildSectionLines(c, 22, 690, 'CONTACT', [
          'sample.candidate03@example.com',
          'WA: 0812-2345-6789',
          'Address: Jl. Anggrek No. 8, Bandung 40115',
        ], { width: 150, gap: 13 });
        sy = buildSectionLines(c, 22, sy - 8, 'SKILLS', [
          'Excel (Pivot, XLOOKUP)',
          'SQL (SELECT, JOIN)',
          'Tableau Dashboards',
        ], { width: 150, gap: 13 });
        buildSectionLines(c, 22, sy - 8, 'EDUCATION', [
          { text: 'Universitas Padjadjaran Fiktif', bold: true },
          'B.A. Business Admin',
          'Graduated 2024',
        ], { width: 150, gap: 13 });

        // Right main pane
        let my = buildSectionLines(c, 212, 742, 'PROFILE', [
          'Operations graduate turning raw order spreadsheets into readable tracking logs.',
        ], { width: 352 });
        buildSectionLines(c, 212, my - 10, 'EXPERIENCE', [
          { text: 'Business Operations Intern - PT Karya Mandiri Fiktif', bold: true },
          'Jun 2023 - Dec 2024',
          '- Maintained weekly supplier tracking sheets in Excel.',
          '- Extracted fulfillment backlog records using SQL.',
          '- Built service-level summary views in Tableau.',
          '- Coordinated shift handoff checklists with warehouse supervisors.',
        ], { width: 352 });
        return [c];
      },
    },
    {
      id: '04-table-based',
      filename: '04-table-based.pdf',
      layout: 'table-based',
      language: 'en',
      expectedSkills: ['JavaScript', 'Python', 'SQL'],
      expectedBullets: [
        '- Wrote JavaScript smoke checks for form validation states.',
        '- Built a Python fixture generator to test edge-case inputs.',
        '- Verified test database fixtures using SQL queries.',
        '- Documented defect reproduction steps for sprint triage.',
      ],
      syntheticPii: [
        'sample.candidate04@example.com',
        'HP: +62 815-9876-5432',
        'National ID: 3171011205010004',
      ],
      survivingLandmarks: ['QA Automation Intern', 'Feb 2023 - Oct 2024', 'Class of 2024'],
      expectedPages: 1,
      sampleJobDescription:
        'QA Automation Engineer. Looking for JavaScript, Python, SQL, and Playwright.',
      buildPages() {
        const c = [];
        c.push(textCmd(48, 745, 16, 'Raka Wijaya', { bold: true }));
        c.push(textCmd(48, 727, 9.5, 'sample.candidate04@example.com | HP: +62 815-9876-5432 | National ID: 3171011205010004'));

        // Skills table grid
        c.push(textCmd(48, 696, 11, 'SKILLS MATRIX', { bold: true }));
        c.push(rectCmd(48, 616, 516, 72, { stroke: '0.6 0.65 0.7' }));
        c.push(lineCmd(48, 666, 564, 666, { stroke: '0.6 0.65 0.7' }));
        c.push(lineCmd(48, 642, 564, 642, { stroke: '0.6 0.65 0.7' }));
        c.push(lineCmd(210, 688, 210, 616, { stroke: '0.6 0.65 0.7' }));
        c.push(textCmd(56, 673, 9.5, 'Category', { bold: true }));
        c.push(textCmd(220, 673, 9.5, 'Tools & Evidence', { bold: true }));
        c.push(textCmd(56, 650, 9.5, 'Languages'));
        c.push(textCmd(220, 650, 9.5, 'JavaScript, Python, SQL'));
        c.push(textCmd(56, 625, 9.5, 'Testing'));
        c.push(textCmd(220, 625, 9.5, 'Regression checklists, CSV boundary fixtures'));

        // Experience table grid
        c.push(textCmd(48, 588, 11, 'EXPERIENCE TABLE', { bold: true }));
        c.push(rectCmd(48, 456, 516, 124, { stroke: '0.6 0.65 0.7' }));
        c.push(lineCmd(48, 558, 564, 558, { stroke: '0.6 0.65 0.7' }));
        c.push(lineCmd(210, 580, 210, 456, { stroke: '0.6 0.65 0.7' }));
        c.push(textCmd(56, 565, 9.5, 'Role & Period', { bold: true }));
        c.push(textCmd(220, 565, 9.5, 'Key Contributions', { bold: true }));
        // Emit left cell block then right cell block cleanly
        c.push(textCmd(56, 540, 9.5, 'QA Automation Intern', { bold: true }));
        c.push(textCmd(56, 524, 9, 'PT Uji Sistem Fiktif'));
        c.push(textCmd(56, 508, 9, 'Feb 2023 - Oct 2024'));
        c.push(textCmd(220, 540, 9.5, '- Wrote JavaScript smoke checks for form validation states.'));
        c.push(textCmd(220, 522, 9.5, '- Built a Python fixture generator to test edge-case inputs.'));
        c.push(textCmd(220, 504, 9.5, '- Verified test database fixtures using SQL queries.'));
        c.push(textCmd(220, 486, 9.5, '- Documented defect reproduction steps for sprint triage.'));

        buildSectionLines(c, 48, 424, 'EDUCATION', [
          { text: 'Politeknik Fiktif Jakarta - D4 Software Engineering (Class of 2024)', bold: true },
        ]);
        return [c];
      },
    },
    {
      id: '05-header-footer-heavy',
      filename: '05-header-footer-heavy.pdf',
      layout: 'header-footer-heavy',
      language: 'en',
      expectedSkills: ['JavaScript', 'React', 'HTML', 'CSS'],
      expectedBullets: [
        '- Built responsive form components in React for mobile browsers.',
        '- Standardized accessible button labels across dashboard screens in HTML and CSS.',
        '- Refactored client-side upload checks in JavaScript to validate file extensions.',
        '- Paired with backend teammates to test bilingual validation error states.',
      ],
      syntheticPii: [
        'sample.candidate05@example.com',
        'Mobile: +62 817-3344-5566',
        'Birthdate: 05 September 2002',
        'Home Address: Jl. Mawar No. 45, Sleman, Yogyakarta 55281',
      ],
      survivingLandmarks: ['Frontend Developer Intern', 'Aug 2023 - Dec 2024', 'Graduated 2024'],
      expectedPages: 1,
      sampleJobDescription:
        'Frontend Developer. Skills needed: JavaScript, React, HTML, CSS, and TypeScript.',
      buildPages() {
        const c = [];
        // Dense header block
        c.push(rectCmd(36, 660, 540, 108, { fill: '0.95 0.96 0.98', stroke: '0.7 0.75 0.82' }));
        c.push(textCmd(48, 744, 16, 'Dina Kusuma - Frontend Developer Intern', { bold: true }));
        c.push(textCmd(48, 725, 9.5, 'Email: sample.candidate05@example.com | Mobile: +62 817-3344-5566'));
        c.push(textCmd(48, 710, 9.5, 'Birthdate: 05 September 2002 | Availability: Immediate Full-Time'));
        c.push(textCmd(48, 695, 9.5, 'Home Address: Jl. Mawar No. 45, Sleman, Yogyakarta 55281'));
        c.push(textCmd(48, 678, 9, 'Portfolio Header: UI Accessibility | Responsive Web | Bilingual Forms'));

        // Body
        let y = buildSectionLines(c, 48, 632, 'SKILLS', ['JavaScript, React, HTML, CSS, Responsive Layout']);
        y = buildSectionLines(c, 48, y - 8, 'EXPERIENCE', [
          { text: 'Frontend Developer Intern - Studio Web Fiktif (Aug 2023 - Dec 2024)', bold: true },
          '- Built responsive form components in React for mobile browsers.',
          '- Standardized accessible button labels across dashboard screens in HTML and CSS.',
          '- Refactored client-side upload checks in JavaScript to validate file extensions.',
          '- Paired with backend teammates to test bilingual validation error states.',
        ]);
        buildSectionLines(c, 48, y - 8, 'EDUCATION', [
          { text: 'Universitas Gadjah Fiktif - B.Sc. Computer Science (Graduated 2024)', bold: true },
        ]);

        // Dense footer block
        c.push(lineCmd(36, 92, 576, 92));
        c.push(textCmd(48, 74, 8.5, 'Footer Note: Fictional candidate profile for CV layout verification.', { color: '0.35 0.35 0.35' }));
        c.push(textCmd(48, 60, 8.5, 'References available upon request | Document ID: LK-HF-05 | Page 1 of 1', { color: '0.35 0.35 0.35' }));
        c.push(textCmd(48, 46, 8.5, 'Contact again at sample.candidate05@example.com for interview scheduling.', { color: '0.35 0.35 0.35' }));
        return [c];
      },
    },
    {
      id: '06-multi-page',
      filename: '06-multi-page.pdf',
      layout: 'multi-page',
      language: 'en',
      expectedSkills: ['Python', 'SQL', 'Excel', 'Tableau'],
      expectedBullets: [
        '- Built a Python script to normalize merchant category tags across monthly exports.',
        '- Designed Excel variance templates for finance reviewers.',
        '- Wrote SQL queries to track repeat customer orders by week.',
        '- Prepared Tableau charts showing regional fulfillment delays.',
        '- Documented weekly data handoff rules for new reporting interns.',
      ],
      syntheticPii: [
        'sample.candidate06@example.com',
        '+62 818-7766-5544',
        'NIK: 3273011504010006',
      ],
      survivingLandmarks: ['Data Analyst Intern', 'Jan 2023 - Dec 2024', 'Graduated 2023'],
      expectedPages: 2,
      sampleJobDescription:
        'Junior Data Analyst. Requirements: Python, SQL, Excel, Tableau, and Looker Studio.',
      buildPages() {
        const p1 = [];
        p1.push(textCmd(54, 744, 18, 'Arief Hidayat', { bold: true }));
        p1.push(textCmd(54, 724, 9.5, 'sample.candidate06@example.com | +62 818-7766-5544 | NIK: 3273011504010006'));
        let y1 = buildSectionLines(p1, 54, 692, 'SUMMARY', [
          'Analytical graduate with two progressive internships across data cleanup and operational reporting.',
        ]);
        y1 = buildSectionLines(p1, 54, y1 - 8, 'SKILLS', ['Python, SQL, Excel, Tableau']);
        y1 = buildSectionLines(p1, 54, y1 - 8, 'EDUCATION', [
          { text: 'Universitas Terbuka Fiktif - B.Sc. Information Systems (Graduated 2023)', bold: true },
        ]);
        buildSectionLines(p1, 54, y1 - 8, 'EXPERIENCE', [
          { text: 'Data Analyst Intern - PT Analitik Fiktif (Jan 2023 - Dec 2024)', bold: true },
          '- Built a Python script to normalize merchant category tags across monthly exports.',
          '- Designed Excel variance templates for finance reviewers.',
          '- Wrote SQL queries to track repeat customer orders by week.',
        ]);
        p1.push(textCmd(54, 40, 8.5, 'Arief Hidayat - Page 1 of 2', { color: '0.4 0.4 0.4' }));

        const p2 = [];
        let y2 = buildSectionLines(p2, 54, 738, 'EXPERIENCE (CONTINUED)', [
          { text: 'Reporting Assistant - CV Niaga Fiktif (Jun 2022 - Dec 2022)', bold: true },
          '- Prepared Tableau charts showing regional fulfillment delays.',
          '- Documented weekly data handoff rules for new reporting interns.',
        ]);
        buildSectionLines(p2, 54, y2 - 12, 'PROJECTS', [
          { text: 'Public Transit Delay Notebook', bold: true },
          'Cleaned public CSV schedules with Python and summarized peak-hour bottlenecks.',
        ]);
        p2.push(textCmd(54, 40, 8.5, 'Arief Hidayat - Page 2 of 2', { color: '0.4 0.4 0.4' }));
        return [p1, p2];
      },
    },
    {
      id: '07-education-first',
      filename: '07-education-first.pdf',
      layout: 'education-first',
      language: 'en',
      expectedSkills: ['Python', 'SQL', 'JavaScript'],
      expectedBullets: [
        '- Guided 25 first-year students during weekly Python programming labs.',
        '- Graded SQL schema assignments and gave structured feedback notes.',
        '- Built a JavaScript study schedule tracker for campus peer tutoring.',
        '- Maintained lab attendance spreadsheets for faculty coordinators.',
      ],
      syntheticPii: [
        'sample.candidate07@example.com',
        '0819-2233-4455',
        'Date of Birth: 20 November 2003',
      ],
      survivingLandmarks: ['Lab Assistant', 'Sep 2023 - Nov 2024', 'Expected Graduation 2025'],
      expectedPages: 1,
      sampleJobDescription:
        'Software Engineering Intern. Required: Python, SQL, JavaScript, and Git.',
      buildPages() {
        const c = [];
        c.push(textCmd(54, 744, 18, 'Larasati Dewi', { bold: true }));
        c.push(textCmd(54, 725, 9.5, 'sample.candidate07@example.com | 0819-2233-4455 | Date of Birth: 20 November 2003'));

        let y = buildSectionLines(c, 54, 692, 'EDUCATION', [
          { text: 'Universitas Teknologi Fiktif - B.Sc. Computer Science (Expected Graduation 2025)', bold: true },
          'GPA: 3.85/4.00',
          'Coursework: Algorithms, Relational Databases, Web Engineering, Software Testing.',
        ]);
        y = buildSectionLines(c, 54, y - 8, 'SKILLS', ['Python, SQL, JavaScript']);
        y = buildSectionLines(c, 54, y - 8, 'CAMPUS EXPERIENCE & PROJECTS', [
          { text: 'Lab Assistant - Department of Computing (Sep 2023 - Nov 2024)', bold: true },
          '- Guided 25 first-year students during weekly Python programming labs.',
          '- Graded SQL schema assignments and gave structured feedback notes.',
          '- Built a JavaScript study schedule tracker for campus peer tutoring.',
          '- Maintained lab attendance spreadsheets for faculty coordinators.',
        ]);
        return [c];
      },
    },
    {
      id: '08-project-heavy',
      filename: '08-project-heavy.pdf',
      layout: 'project-heavy',
      language: 'en',
      expectedSkills: ['JavaScript', 'Python', 'SQL', 'Excel'],
      expectedBullets: [
        '- Built a JavaScript expense splitter app for student club treasurers.',
        '- Wrote a Python scraper and deduplication script for open scholarship listings.',
        '- Modeled a campus book-lending database in SQL with overdue flags.',
        '- Created an Excel budget forecast workbook for an annual student seminar.',
      ],
      syntheticPii: [
        'sample.candidate08@example.com',
        '+62 821-5544-3322',
        'Address: Jl. Kenanga No. 19, Surabaya 60111',
      ],
      survivingLandmarks: ['Campus Project Lead', 'Jan 2024 - Dec 2024', 'Graduated 2024'],
      expectedPages: 1,
      sampleJobDescription:
        'Product Engineering Intern. Required: JavaScript, Python, SQL, Excel, and REST APIs.',
      buildPages() {
        const c = [];
        c.push(textCmd(54, 744, 18, 'Fajar Nugroho', { bold: true }));
        c.push(textCmd(54, 725, 9.5, 'sample.candidate08@example.com | +62 821-5544-3322 | Address: Jl. Kenanga No. 19, Surabaya 60111'));

        let y = buildSectionLines(c, 54, 692, 'SKILLS', ['JavaScript, Python, SQL, Excel']);
        y = buildSectionLines(c, 54, y - 8, 'PROJECTS (4 COURSEWORK & GITHUB BUILDS)', [
          { text: '1. Club Treasurer App - Campus Project Lead (Jan 2024 - Dec 2024)', bold: true },
          '- Built a JavaScript expense splitter app for student club treasurers.',
          { text: '2. Scholarship Feed Cleaner (GitHub Coursework)', bold: true },
          '- Wrote a Python scraper and deduplication script for open scholarship listings.',
          { text: '3. Campus Library Ledger (Database Course)', bold: true },
          '- Modeled a campus book-lending database in SQL with overdue flags.',
          { text: '4. Seminar Budget Planner (Student Committee)', bold: true },
          '- Created an Excel budget forecast workbook for an annual student seminar.',
        ]);
        buildSectionLines(c, 54, y - 8, 'EDUCATION', [
          { text: 'Institut Teknologi Surabaya Fiktif - B.Sc. Information Systems (Graduated 2024)', bold: true },
        ]);
        return [c];
      },
    },
    {
      id: '09-indonesian',
      filename: '09-indonesian.pdf',
      layout: 'indonesian',
      language: 'id',
      expectedSkills: ['Excel', 'SQL', 'Python'],
      expectedBullets: [
        '- Menyusun laporan mingguan operasional menggunakan Excel untuk tim gudang.',
        '- Membuat skrip Python untuk membersihkan baris data duplikat.',
        '- Membantu rekonsiliasi data transaksi harian menggunakan query SQL.',
        '- Menyiapkan panduan langkah kerja input data bagi anggota tim baru.',
      ],
      syntheticPii: [
        'sample.candidate09@example.com',
        'Telp: 0812-3456-7899',
        'NIK: 3171011205010009',
        'Tanggal Lahir: 12 Mei 2001',
        'Alamat: Jl. Melati No. 12, RT 04/RW 02',
        'Kel. Cipete Utara, Kec. Kebayoran Baru',
        'Jakarta Selatan 12150',
      ],
      survivingLandmarks: ['Staf Administrasi Magang', 'Mei 2023 - Sekarang', 'Lulus 2024'],
      expectedPages: 1,
      sampleJobDescription:
        'Analis Data Junior. Keahlian dibutuhkan: Excel, SQL, Python, dan Power BI.',
      buildPages() {
        const c = [];
        c.push(textCmd(54, 746, 18, 'Putri Wulandari', { bold: true }));
        c.push(textCmd(54, 726, 9.5, 'Email: sample.candidate09@example.com | Telp: 0812-3456-7899'));
        c.push(textCmd(54, 711, 9.5, 'NIK: 3171011205010009 | Tanggal Lahir: 12 Mei 2001'));
        c.push(textCmd(54, 696, 9.5, 'Alamat: Jl. Melati No. 12, RT 04/RW 02'));
        c.push(textCmd(54, 682, 9.5, 'Kel. Cipete Utara, Kec. Kebayoran Baru'));
        c.push(textCmd(54, 668, 9.5, 'Jakarta Selatan 12150'));

        let y = buildSectionLines(c, 54, 636, 'PROFIL SINGKAT', [
          'Lulusan baru S1 Manajemen dengan minat kuat pada pengelolaan data dan pelaporan operasional.',
        ]);
        y = buildSectionLines(c, 54, y - 6, 'KEAHLIAN', ['Keahlian Utama: Excel, SQL, Python']);
        y = buildSectionLines(c, 54, y - 6, 'PENGALAMAN KERJA', [
          { text: 'Staf Administrasi Magang - PT Karya Fiktif Indonesia (Mei 2023 - Sekarang)', bold: true },
          '- Menyusun laporan mingguan operasional menggunakan Excel untuk tim gudang.',
          '- Membuat skrip Python untuk membersihkan baris data duplikat.',
          '- Membantu rekonsiliasi data transaksi harian menggunakan query SQL.',
          '- Menyiapkan panduan langkah kerja input data bagi anggota tim baru.',
        ]);
        buildSectionLines(c, 54, y - 6, 'PENDIDIKAN', [
          { text: 'Universitas Negeri Fiktif - S1 Manajemen (Lulus 2024)', bold: true },
        ]);
        return [c];
      },
    },
    {
      id: '10-mixed-id-en',
      filename: '10-mixed-id-en.pdf',
      layout: 'mixed-id-en',
      language: 'id',
      expectedSkills: ['Python', 'SQL', 'Tableau', 'Excel'],
      expectedBullets: [
        '- Built weekly funnel metrics in SQL dan menyusun ringkasan untuk tim produk.',
        '- Cleaned survey exports dengan Python sebelum visualisasi di Tableau.',
        '- Maintained stakeholder tracking workbooks in Excel.',
        '- Coordinated user feedback sessions dengan tim customer support.',
      ],
      syntheticPii: [
        'sample.candidate10@example.com',
        'WA: +62 811-9988-7766',
        'TTL: Bekasi, 18 Agustus 2000',
        'Home Address: Jl. Sudirman No. 88',
        'Domisili: Kel. Karet Semanggi, Setiabudi, Jakarta Selatan 12930',
      ],
      survivingLandmarks: ['Junior Product Analyst', 'Feb 2023 - Dec 2024', 'Lulus 2022'],
      expectedPages: 1,
      sampleJobDescription:
        'Product Analyst (ID/EN). Required: Python, SQL, Tableau, Excel, and Looker.',
      buildPages() {
        const c = [];
        c.push(textCmd(54, 746, 18, 'Bagas Santoso', { bold: true }));
        c.push(textCmd(54, 726, 9.5, 'sample.candidate10@example.com | WA: +62 811-9988-7766 | TTL: Bekasi, 18 Agustus 2000'));
        c.push(textCmd(54, 711, 9.5, 'Home Address: Jl. Sudirman No. 88'));
        c.push(textCmd(54, 697, 9.5, 'Domisili: Kel. Karet Semanggi, Setiabudi, Jakarta Selatan 12930'));

        let y = buildSectionLines(c, 54, 666, 'RINGKASAN / SUMMARY', [
          'Early-career analyst (0-2 tahun pengalaman) bridging product data dan business reporting.',
        ]);
        y = buildSectionLines(c, 54, y - 6, 'KEAHLIAN / SKILLS', ['Python, SQL, Tableau, Excel']);
        y = buildSectionLines(c, 54, y - 6, 'PENGALAMAN KERJA / WORK EXPERIENCE', [
          { text: 'Junior Product Analyst - PT Digital Fiktif (Feb 2023 - Dec 2024)', bold: true },
          '- Built weekly funnel metrics in SQL dan menyusun ringkasan untuk tim produk.',
          '- Cleaned survey exports dengan Python sebelum visualisasi di Tableau.',
          '- Maintained stakeholder tracking workbooks in Excel.',
          '- Coordinated user feedback sessions dengan tim customer support.',
        ]);
        buildSectionLines(c, 54, y - 6, 'PENDIDIKAN / EDUCATION', [
          { text: 'Universitas Bina Fiktif - S1 Sistem Informasi (Lulus 2022)', bold: true },
        ]);
        return [c];
      },
    },
  ];
}

function createSparseSpecs() {
  return [
    {
      id: 'sparse-two-bullets',
      filename: 'sparse-two-bullets.pdf',
      layout: 'sparse-two-bullets',
      language: 'en',
      expectedSkills: ['Python', 'Excel'],
      expectedBullets: [
        '- Built a Python script to clean duplicate rows.',
        '- Helped prepare weekly sales sheets in Excel.',
      ],
      syntheticPii: ['sparse.two@example.com', '+62 812-0000-0002'],
      survivingLandmarks: ['Data Analyst Intern', 'Jan 2024 - Jun 2024', 'Graduated 2024'],
      expectedPages: 1,
      sampleJobDescription: 'Data Intern. Python, Excel, and SQL required.',
      buildPages() {
        const c = [];
        c.push(textCmd(54, 742, 18, 'Tari Amelia', { bold: true }));
        c.push(textCmd(54, 724, 9.5, 'sparse.two@example.com | +62 812-0000-0002'));
        let y = buildSectionLines(c, 54, 690, 'SKILLS', ['Python, Excel']);
        y = buildSectionLines(c, 54, y - 8, 'EXPERIENCE', [
          { text: 'Data Analyst Intern (Jan 2024 - Jun 2024)', bold: true },
          '- Built a Python script to clean duplicate rows.',
          '- Helped prepare weekly sales sheets in Excel.',
        ]);
        buildSectionLines(c, 54, y - 8, 'EDUCATION', [
          'Universitas Nusantara - B.Sc. Statistics (Graduated 2024)',
        ]);
        return [c];
      },
    },
    {
      id: 'sparse-zero-bullets',
      filename: 'sparse-zero-bullets.pdf',
      layout: 'sparse-zero-bullets',
      language: 'en',
      expectedSkills: ['Python', 'Excel'],
      expectedBullets: [],
      syntheticPii: ['sparse.zero@example.com', '+62 812-0000-0000'],
      survivingLandmarks: ['Graduated 2024'],
      expectedPages: 1,
      sampleJobDescription: 'Data Intern. Python, Excel, and SQL required.',
      buildPages() {
        const c = [];
        c.push(textCmd(54, 742, 18, 'Ilham Saputra', { bold: true }));
        c.push(textCmd(54, 724, 9.5, 'sparse.zero@example.com | +62 812-0000-0000'));
        let y = buildSectionLines(c, 54, 690, 'SKILLS', ['Python, Excel']);
        buildSectionLines(c, 54, y - 8, 'EDUCATION', [
          'Universitas Nusantara, B.Sc. Computer Science (Graduated 2024)',
        ]);
        return [c];
      },
    },
  ];
}

function createInvalidSpecs() {
  return [
    {
      id: 'invalid-mislabeled',
      filename: 'invalid-mislabeled.pdf',
      kind: 'mislabeled',
      expectedCode: 'PDF_UNREADABLE',
      buildBytes() {
        return Buffer.from(
          'Plain text file mislabeled as a PDF CV.\nSkills: Python, Excel\nContact: fake.mislabeled@example.com\n',
          'utf8'
        );
      },
    },
    {
      id: 'invalid-corrupt',
      filename: 'invalid-corrupt.pdf',
      kind: 'corrupt',
      expectedCode: 'PDF_UNREADABLE',
      buildBytes() {
        return Buffer.from(
          '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 99 0 R\n2 0 obj\n<< /Length 500 >>\nstream\ntruncated\nxref\n0 2\nbroken_offset\ntrailer\n<< /Size 2 >>\nstartxref\n999999\n%%EOF\n',
          'utf8'
        );
      },
    },
    {
      id: 'invalid-protected',
      filename: 'invalid-protected.pdf',
      kind: 'protected',
      expectedCode: 'PDF_UNREADABLE',
      buildBytes() {
        const vectorStream = '0 0 100 100 re f';
        return serializePdfObjects(
          [
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents 4 0 R >>`,
            `<< /Length ${vectorStream.length} >>\nstream\n${vectorStream}\nendstream`,
            '<< /Filter /Standard /V 1 /R 2 /O (fictionalowner) /U (fictionaluser) /P -4 >>',
          ],
          '/Encrypt 5 0 R '
        );
      },
    },
    {
      id: 'invalid-image-only',
      filename: 'invalid-image-only.pdf',
      kind: 'image-only',
      expectedCode: 'PDF_UNREADABLE',
      buildBytes() {
        const vectorStream = '0.2 0.2 0.2 rg 0 0 100 100 re f\n0.85 0.85 0.85 rg 140 600 300 40 re f';
        return serializePdfObjects([
          '<< /Type /Catalog /Pages 2 0 R >>',
          '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents 4 0 R >>`,
          `<< /Length ${vectorStream.length} >>\nstream\n${vectorStream}\nendstream`,
        ]);
      },
    },
  ];
}

function toManifestEntry(spec) {
  return {
    id: spec.id,
    filename: spec.filename,
    layout: spec.layout,
    language: spec.language,
    expectedSkills: spec.expectedSkills,
    expectedBullets: spec.expectedBullets,
    syntheticPii: spec.syntheticPii,
    survivingLandmarks: spec.survivingLandmarks,
    expectedPages: spec.expectedPages,
    sampleJobDescription: spec.sampleJobDescription,
  };
}

export async function generateFixtures(outputDir = '/tmp/latihkerja-fixtures') {
  await mkdir(outputDir, { recursive: true });

  const readableSpecs = createReadableSpecs();
  const sparseSpecs = createSparseSpecs();
  const invalidSpecs = createInvalidSpecs();

  for (const spec of [...readableSpecs, ...sparseSpecs]) {
    await writeFile(path.join(outputDir, spec.filename), buildPdf(spec.buildPages()));
  }
  for (const spec of invalidSpecs) {
    await writeFile(path.join(outputDir, spec.filename), spec.buildBytes());
  }

  const manifest = {
    readable: readableSpecs.map(toManifestEntry),
    sparse: sparseSpecs.map(toManifestEntry),
    invalid: invalidSpecs.map(({ id, filename, kind, expectedCode }) => ({
      id,
      filename,
      kind,
      expectedCode,
    })),
  };

  await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const outputDir = process.argv[2] || '/tmp/latihkerja-fixtures';
  const manifest = await generateFixtures(outputDir);
  console.log(
    `Generated ${manifest.readable.length} readable, ${manifest.sparse.length} sparse, and ${manifest.invalid.length} invalid fixtures in ${outputDir}`
  );
}
