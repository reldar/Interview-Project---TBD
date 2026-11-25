import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALIAS_GROUPS,
  ERROR_CODES,
  ERROR_STATUS,
  FIXTURES,
  MAX_CV_TEXT_CHARS,
  MAX_JD_CHARS,
  buildCvReportText,
  countCandidateBullets,
  getErrorCopy,
  normalizeKeyword,
  validateAnalysisPayload,
  validateCvText,
  validateJobDescription,
  validateLanguage,
} from '../lib/contracts.js';
import { REDACTION_PLACEHOLDERS, redactAnalysisOutput, redactPii } from '../lib/redact.js';

describe('PII Redaction (§8) — lib/redact.js', () => {
  it('masks standard, plus-tagged, subdomain, and mailto emails', () => {
    const samples = [
      'Contact: sample@example.com',
      'Campus email: first.last+tag@sub.campus.ac.id',
      'Link: mailto:user@example.org for interviews',
    ];
    for (const input of samples) {
      const out = redactPii(input);
      assert.ok(out.includes(REDACTION_PLACEHOLDERS.email), `Expected email placeholder for: ${input}`);
      assert.doesNotMatch(out, /@/);
      assert.doesNotMatch(out, /mailto:/i);
    }
  });

  it('masks Indonesian local, international, and labeled phone numbers', () => {
    const rawPhones = [
      '0812-3456-7890',
      '0812 3456 7890',
      '081234567890',
      '(021) 555-1234',
      '021-5551234',
      '+62 812-3456-7890',
      '+6281234567890',
      '+1 (555) 123-4567',
    ];
    for (const phone of rawPhones) {
      const out = redactPii(`Hubungi ${phone} segera`);
      assert.equal(
        out,
        `Hubungi ${REDACTION_PLACEHOLDERS.phone} segera`,
        `Expected phone "${phone}" to be redacted, got: ${out}`
      );
    }

    const labeled = [
      ['HP: 0812-3456-7890', '0812-3456-7890'],
      ['WA: 0812 3456 7890', '0812 3456 7890'],
      ['Telp: 021-5551234', '021-5551234'],
      ['Phone: +62 812-3456-7890', '+62 812-3456-7890'],
    ];
    for (const [line, rawNumber] of labeled) {
      const out = redactPii(line);
      assert.ok(out.includes(REDACTION_PLACEHOLDERS.phone), `Expected phone placeholder for: ${line}`);
      assert.ok(!out.includes(rawNumber), `Raw number leaked for: ${line}`);
    }
  });

  it('masks 16-digit NIK, labeled government IDs, and ID/EN labeled birthdates', () => {
    const cases = [
      ['3171011205010001', '3171011205010001'],
      ['NIK: 3171011205010001', '3171011205010001'],
      ['No. KTP: 3171-0112-0501-0001', '3171-0112-0501-0001'],
      ['National ID: IDN-88990011', 'IDN-88990011'],
      ['Tanggal Lahir: 12 Mei 2001', '12 Mei 2001'],
      ['TTL: Bandung, 14 Agustus 2002', '14 Agustus 2002'],
      ['Date of Birth: May 12, 2001', 'May 12, 2001'],
      ['DOB: 1999-08-17', '1999-08-17'],
    ];
    for (const [input, secret] of cases) {
      const out = redactPii(input);
      assert.ok(out.includes(REDACTION_PLACEHOLDERS.identity), `Expected identity placeholder for: ${input}`);
      assert.ok(!out.includes(secret), `Identity secret "${secret}" leaked in: ${out}`);
    }

    // Labeled ID redaction must not greedily swallow trailing skills or subsequent addresses
    const nikWithSkills = redactPii('NIK: 3171011205010001 Python SQL Excel experience');
    assert.equal(nikWithSkills, `NIK: ${REDACTION_PLACEHOLDERS.identity} Python SQL Excel experience`);

    const nikWithAddress = redactPii('NIK: 3273011205019002 at Jl. Diponegoro No. 55, Bandung 40115.');
    assert.ok(nikWithAddress.includes(REDACTION_PLACEHOLDERS.identity));
    assert.ok(nikWithAddress.includes(REDACTION_PLACEHOLDERS.address));
    assert.ok(!nikWithAddress.includes('3273011205019002'));
    assert.ok(!nikWithAddress.includes('Diponegoro'));
    assert.ok(!nikWithAddress.includes('40115'));
  });

  it('masks labeled single-line, multi-line, unlabeled street, and two-column tab-separated addresses', () => {
    const singleLineCases = [
      ['Alamat: Jl. Melati No. 12, Jakarta Selatan 12160', 'Jl. Melati'],
      ['Domisili: Jl. Anggrek No. 8, Bandung 40115', 'Jl. Anggrek'],
      ['Home Address: Jl. Sudirman No. 88, Jakarta Pusat 10220', 'Jl. Sudirman'],
      ['Address: 742 Evergreen Terrace, Apt 4B', 'Evergreen Terrace'],
      ['Jl. Melati No. 12, Jakarta Selatan 12160', 'Jl. Melati'],
    ];
    for (const [input, fragment] of singleLineCases) {
      const out = redactPii(input);
      assert.ok(out.includes(REDACTION_PLACEHOLDERS.address), `Expected address placeholder for: ${input}`);
      assert.ok(!out.includes(fragment), `Address fragment "${fragment}" leaked in: ${out}`);
    }

    const multiLine = [
      'Alamat: Jl. Melati No. 12',
      'RT 02/RW 05',
      'Kel. Cipete Utara, Kec. Kebayoran Baru',
      'Jakarta Selatan 12160',
      'EXPERIENCE',
      'Data Analyst Intern',
    ].join('\n');
    const redactedMulti = redactPii(multiLine);
    assert.ok(redactedMulti.includes(REDACTION_PLACEHOLDERS.address));
    assert.ok(!redactedMulti.includes('Jl. Melati'));
    assert.ok(!redactedMulti.includes('RT 02/RW 05'));
    assert.ok(!redactedMulti.includes('Cipete Utara'));
    assert.ok(!redactedMulti.includes('12160'));
    assert.ok(redactedMulti.includes('EXPERIENCE'));
    assert.ok(redactedMulti.includes('Data Analyst Intern'));

    const twoCol = [
      'Home Address: Jl. Melati No. 12\tData Analyst Intern',
      'RT 02/RW 05, Jakarta Selatan 12160\tSoftware Engineer',
    ].join('\n');
    const redactedTwoCol = redactPii(twoCol);
    assert.ok(redactedTwoCol.includes(REDACTION_PLACEHOLDERS.address));
    assert.ok(!redactedTwoCol.includes('Jl. Melati'));
    assert.ok(!redactedTwoCol.includes('RT 02/RW 05'));
    assert.ok(!redactedTwoCol.includes('12160'));
    assert.ok(redactedTwoCol.includes('Data Analyst Intern'));
    assert.ok(redactedTwoCol.includes('Software Engineer'));
  });

  it('preserves graduation years, employment dates, GPA, metrics, skills, and nearby job titles', () => {
    const cv = [
      'Nadia Putri — Data Analyst Intern | Software Engineer',
      'Email: sample@example.com | HP: 0812-3456-7890',
      'Alamat: Jl. Melati No. 12, Jakarta Selatan 12160',
      'EDUCATION: Graduated 2024 | Lulus 2024 | Class of 2024 | GPA 3.85/4.00',
      'EXPERIENCE: Data Analyst Intern (Jan 2023 - Dec 2024) | 2021 - 2024 | Mei 2023 - Sekarang',
      'SKILLS: Python, SQL, Excel',
      '- Cleaned 10,000 rows in Python with 99.5% schema accuracy.',
    ].join('\n');

    const out = redactPii(cv);
    const mustSurvive = [
      'Graduated 2024',
      'Lulus 2024',
      'Class of 2024',
      'Jan 2023 - Dec 2024',
      '2021 - 2024',
      'Mei 2023 - Sekarang',
      '3.85/4.00',
      '10,000 rows',
      '99.5%',
      'Python',
      'SQL',
      'Excel',
      'Data Analyst Intern',
      'Software Engineer',
    ];
    for (const token of mustSurvive) {
      assert.ok(out.includes(token), `Expected surviving token "${token}" in:\n${out}`);
    }
    assert.ok(!out.includes('sample@example.com'));
    assert.ok(!out.includes('0812-3456-7890'));
    assert.ok(!out.includes('Jl. Melati'));
  });

  it('redactAnalysisOutput strips synthetic PII embedded in matchedKeywords, missingKeywords, and rewrites', () => {
    const dirty = {
      atsScore: 72,
      matchedKeywords: ['Python', 'Email sample@example.com'],
      missingKeywords: ['SQL', '+62 812-3456-7890'],
      rewrites: [
        {
          original: 'Contact sample@example.com at Jl. Melati No. 12, Jakarta Selatan 12160',
          improved: 'Built Python ETL for NIK: 3171011205010001 and HP: 0812-3456-7890',
          reason: 'Verify DOB: 1999-08-17 and mailto:boss@example.org',
        },
      ],
    };

    const clean = redactAnalysisOutput(dirty);
    const serialized = JSON.stringify(clean);
    for (const secret of [
      'sample@example.com',
      'boss@example.org',
      '+62 812-3456-7890',
      '0812-3456-7890',
      '3171011205010001',
      '1999-08-17',
      'Jl. Melati',
      '12160',
    ]) {
      assert.ok(!serialized.includes(secret), `Secret "${secret}" leaked in redactAnalysisOutput`);
    }
    assert.ok(clean.matchedKeywords.includes('Python'));
    assert.ok(clean.missingKeywords.includes('SQL'));
    assert.ok(clean.matchedKeywords[1].includes(REDACTION_PLACEHOLDERS.email));
    assert.ok(clean.missingKeywords[1].includes(REDACTION_PLACEHOLDERS.phone));
    assert.ok(clean.rewrites[0].original.includes(REDACTION_PLACEHOLDERS.address));
    assert.ok(clean.rewrites[0].improved.includes(REDACTION_PLACEHOLDERS.identity));
  });
});

describe('Input & Analysis Contracts (§§4, 5, 7) — lib/contracts.js', () => {
  it('validates language, jobDescription, and cvText including exact length boundaries', () => {
    assert.deepEqual(validateLanguage('id'), { ok: true, value: 'id' });
    assert.deepEqual(validateLanguage('en'), { ok: true, value: 'en' });
    assert.equal(validateLanguage('fr').ok, false);
    assert.equal(validateLanguage('').ok, false);
    assert.equal(validateLanguage(null).ok, false);

    assert.equal(validateJobDescription('').ok, false);
    assert.equal(validateJobDescription('   \n\t  ').ok, false);
    assert.equal(validateJobDescription('---!!!').ok, false);
    assert.equal(validateJobDescription('a'.repeat(MAX_JD_CHARS)).ok, true);
    assert.equal(validateJobDescription('a'.repeat(MAX_JD_CHARS + 1)).ok, false);

    assert.equal(validateCvText('').ok, false);
    assert.equal(validateCvText('   ').ok, false);
    assert.equal(validateCvText('a'.repeat(MAX_CV_TEXT_CHARS)).ok, true);
    assert.equal(validateCvText('a'.repeat(MAX_CV_TEXT_CHARS + 1)).ok, false);
  });

  it('accepts valid EN and ID fixtures in validateAnalysisPayload', () => {
    const enRes = validateAnalysisPayload(FIXTURES.en.response, FIXTURES.en.cvText);
    assert.equal(enRes.ok, true);
    assert.equal(enRes.isSparse, false);
    assert.equal(enRes.value.atsScore, 68);
    assert.equal(enRes.value.rewrites.length, 3);

    const idRes = validateAnalysisPayload(FIXTURES.id.response, FIXTURES.id.cvText);
    assert.equal(idRes.ok, true);
    assert.equal(idRes.isSparse, false);
    assert.equal(idRes.value.atsScore, 68);
    assert.equal(idRes.value.rewrites.length, 3);
  });

  it('rejects invalid atsScore values (float, NaN, -1, 101, string) while accepting 0 and 100', () => {
    for (const validScore of [0, 100]) {
      const res = validateAnalysisPayload(
        { ...FIXTURES.en.response, atsScore: validScore },
        FIXTURES.en.cvText
      );
      assert.equal(res.ok, true, `Expected score ${validScore} to be accepted`);
    }

    for (const badScore of [68.5, Number.NaN, -1, 101, '68', null, Number.POSITIVE_INFINITY]) {
      const res = validateAnalysisPayload(
        { ...FIXTURES.en.response, atsScore: badScore },
        FIXTURES.en.cvText
      );
      assert.equal(res.ok, false, `Expected score ${String(badScore)} to be rejected`);
    }
  });

  it('deduplicates aliases within a group and rejects overlapping canonical aliases across matched and missing', () => {
    assert.equal(normalizeKeyword('JS'), normalizeKeyword('JavaScript'));
    assert.equal(normalizeKeyword('MS Excel'), normalizeKeyword('Excel'));
    assert.ok(Object.keys(ALIAS_GROUPS).length >= 10);

    const deduped = validateAnalysisPayload(
      {
        ...FIXTURES.en.response,
        matchedKeywords: ['Python', 'Python 3', 'MS Excel', 'Excel'],
        missingKeywords: ['SQL', 'Structured Query Language'],
      },
      FIXTURES.en.cvText
    );
    assert.equal(deduped.ok, true);
    assert.equal(deduped.value.matchedKeywords.length, 2);
    assert.equal(deduped.value.missingKeywords.length, 1);

    const overlapJs = validateAnalysisPayload(
      {
        ...FIXTURES.en.response,
        matchedKeywords: ['JS', 'Excel'],
        missingKeywords: ['JavaScript'],
      },
      FIXTURES.en.cvText
    );
    assert.equal(overlapJs.ok, false);

    const overlapExcel = validateAnalysisPayload(
      {
        ...FIXTURES.en.response,
        matchedKeywords: ['MS Excel'],
        missingKeywords: ['Excel'],
      },
      FIXTURES.en.cvText
    );
    assert.equal(overlapExcel.ok, false);
  });

  it('rejects blank rewrite fields, >5 rewrites, duplicate originals, section headers, and untraceable originals', () => {
    const cvFive = [
      '- Built a Python script to clean duplicate rows.',
      '- Helped make weekly reports in Excel for operations.',
      '- Wrote instructions for preparing recurring reports.',
      '- Queried order tables in SQL to find delayed shipments.',
      '- Organized student club event schedules in spreadsheets.',
      '- Maintained lab attendance sheets for teaching staff.',
    ].join('\n');

    // Blank field
    const blankReason = validateAnalysisPayload(
      {
        ...FIXTURES.en.response,
        rewrites: FIXTURES.en.response.rewrites.map((r, i) => (i === 0 ? { ...r, reason: '   ' } : r)),
      },
      FIXTURES.en.cvText
    );
    assert.equal(blankReason.ok, false);

    // >5 rewrites
    const sixRewrites = cvFive.split('\n').map((line) => ({
      original: line.slice(2),
      improved: line.slice(2),
      reason: 'Clarifies action.',
    }));
    assert.equal(
      validateAnalysisPayload({ ...FIXTURES.en.response, rewrites: sixRewrites }, cvFive).ok,
      false
    );

    // Duplicate originals
    const dupRewrites = [
      FIXTURES.en.response.rewrites[0],
      FIXTURES.en.response.rewrites[0],
      FIXTURES.en.response.rewrites[1],
    ];
    assert.equal(
      validateAnalysisPayload({ ...FIXTURES.en.response, rewrites: dupRewrites }, FIXTURES.en.cvText).ok,
      false
    );

    // Section header as original
    const headerCv = `EXPERIENCE\n${FIXTURES.en.cvText}`;
    const headerRewrites = [
      { original: 'EXPERIENCE', improved: 'Work Experience Summary', reason: 'Header check.' },
      FIXTURES.en.response.rewrites[0],
      FIXTURES.en.response.rewrites[1],
    ];
    assert.equal(
      validateAnalysisPayload({ ...FIXTURES.en.response, rewrites: headerRewrites }, headerCv).ok,
      false
    );

    // Hallucinated / untraceable original
    const hallucinatedRewrites = [
      {
        original: 'Architected Kubernetes clusters across multi-region cloud accounts.',
        improved: 'Managed cloud infrastructure reliably.',
        reason: 'Not present in source CV.',
      },
      FIXTURES.en.response.rewrites[1],
      FIXTURES.en.response.rewrites[2],
    ];
    assert.equal(
      validateAnalysisPayload({ ...FIXTURES.en.response, rewrites: hallucinatedRewrites }, FIXTURES.en.cvText).ok,
      false
    );
  });

  it('rejects fabricated metrics in improved while allowing numbers present in the source CV', () => {
    const fabricatedPct = validateAnalysisPayload(
      {
        ...FIXTURES.en.response,
        rewrites: [
          {
            original: 'Built a Python script to clean duplicate rows.',
            improved: 'Wrote a Python script to cut duplicate rows by 40%.',
            reason: 'Fabricates percentage not in CV.',
          },
          FIXTURES.en.response.rewrites[1],
          FIXTURES.en.response.rewrites[2],
        ],
      },
      FIXTURES.en.cvText
    );
    assert.equal(fabricatedPct.ok, false);

    const fabricatedCount = validateAnalysisPayload(
      {
        ...FIXTURES.en.response,
        rewrites: [
          {
            original: 'Built a Python script to clean duplicate rows.',
            improved: 'Wrote a Python script to clean 50,000 rows weekly.',
            reason: 'Fabricates row count not in CV.',
          },
          FIXTURES.en.response.rewrites[1],
          FIXTURES.en.response.rewrites[2],
        ],
      },
      FIXTURES.en.cvText
    );
    assert.equal(fabricatedCount.ok, false);

    const sourcedCv = [
      '- Built a Python script to clean 10,000 duplicate rows with 99.5% accuracy.',
      '- Helped make weekly reports in Excel for 3 teams.',
      '- Wrote instructions for preparing recurring reports.',
    ].join('\n');
    const allowedNumbers = validateAnalysisPayload(
      {
        atsScore: 74,
        matchedKeywords: ['Python', 'Excel'],
        missingKeywords: ['SQL'],
        rewrites: [
          {
            original: 'Built a Python script to clean 10,000 duplicate rows with 99.5% accuracy.',
            improved: 'Developed a Python script removing duplicates across 10000 rows at 99,5% accuracy.',
            reason: 'Retains candidate-supplied figures cleanly.',
          },
          {
            original: 'Helped make weekly reports in Excel for 3 teams.',
            improved: 'Contributed to weekly Excel reporting shared with 3 teams.',
            reason: 'Retains team count from CV.',
          },
          {
            original: 'Wrote instructions for preparing recurring reports.',
            improved: 'Documented recurring reporting steps for teammates.',
            reason: 'Clarifies purpose without inventing numbers.',
          },
        ],
      },
      sourcedCv
    );
    assert.equal(allowedNumbers.ok, true);
  });

  it('enforces the sparse-CV rule for 0, 1, 2 bullets vs >=3 bullets', () => {
    const zeroBulletCv = 'Ilham Saputra\nSKILLS\nPython, Excel\nEDUCATION\nUniversitas Nusantara (Graduated 2024)';
    assert.equal(countCandidateBullets(zeroBulletCv), 0);
    const zeroRes = validateAnalysisPayload(FIXTURES.sparseZero, zeroBulletCv);
    assert.equal(zeroRes.ok, true);
    assert.equal(zeroRes.isSparse, true);
    assert.equal(zeroRes.value.rewrites.length, 0);

    const oneBulletCv = [
      'SKILLS: Python, Excel',
      '- Built a Python script to clean duplicate rows.',
    ].join('\n');
    assert.equal(countCandidateBullets(oneBulletCv), 1);
    const oneRes = validateAnalysisPayload(
      { ...FIXTURES.sparseTwo, rewrites: [FIXTURES.sparseTwo.rewrites[0]] },
      oneBulletCv
    );
    assert.equal(oneRes.ok, true);
    assert.equal(oneRes.isSparse, true);

    const twoBulletCv = [
      'SKILLS: Python, Excel',
      '- Built a Python script to clean duplicate rows.',
      '- Helped make weekly reports in Excel.',
    ].join('\n');
    assert.equal(countCandidateBullets(twoBulletCv), 2);
    const twoRes = validateAnalysisPayload(FIXTURES.sparseTwo, twoBulletCv);
    assert.equal(twoRes.ok, true);
    assert.equal(twoRes.isSparse, true);
    assert.equal(twoRes.value.rewrites.length, 2);

    // >=3 bullets rejects <3 rewrites unless allowSparse: true
    assert.equal(countCandidateBullets(FIXTURES.en.cvText), 3);
    assert.equal(validateAnalysisPayload(FIXTURES.sparseTwo, FIXTURES.en.cvText).ok, false);
    const forcedSparse = validateAnalysisPayload(FIXTURES.sparseTwo, FIXTURES.en.cvText, { allowSparse: true });
    assert.equal(forcedSparse.ok, true);
    assert.equal(forcedSparse.isSparse, true);
  });

  it('buildCvReportText formats ID & EN, empty groups, sparse rewrites, and excludes sessionId & synthetic PII', () => {
    const leakyAnalysis = {
      sessionId: 'sess_secret_do_not_export_999',
      atsScore: 68,
      matchedKeywords: ['Python', 'sample@example.com'],
      missingKeywords: ['SQL'],
      rewrites: [
        {
          original: 'Built Python scripts (HP: 0812-3456-7890)',
          improved: 'Wrote Python scripts at Jl. Melati No. 12, Jakarta Selatan 12160',
          reason: 'Verify NIK: 3171011205010001 and add row count.',
        },
      ],
    };

    const enReport = buildCvReportText(leakyAnalysis, 'en');
    const idReport = buildCvReportText(leakyAnalysis, 'id');

    assert.ok(enReport.includes('68/100'));
    assert.ok(enReport.includes('Original:'));
    assert.ok(enReport.includes('Improved:'));
    assert.ok(enReport.includes('Reason:'));
    assert.ok(enReport.includes('Showing 1 rewrite'));

    assert.ok(idReport.includes('68/100'));
    assert.ok(idReport.includes('Asli:'));
    assert.ok(idReport.includes('Usulan:'));
    assert.ok(idReport.includes('Alasan:'));
    assert.ok(idReport.includes('Menampilkan 1 usulan perbaikan'));

    for (const report of [enReport, idReport]) {
      for (const secret of [
        'sess_secret_do_not_export_999',
        'sample@example.com',
        '0812-3456-7890',
        'Jl. Melati',
        '3171011205010001',
      ]) {
        assert.ok(!report.includes(secret), `Secret "${secret}" leaked in exported report`);
      }
    }

    // Empty groups & sparse 0 rewrites
    const emptyEn = buildCvReportText(
      { sessionId: 'sess_empty', atsScore: 20, matchedKeywords: [], missingKeywords: [], rewrites: [] },
      'en'
    );
    assert.ok(emptyEn.includes('No advertised skills evidenced yet'));
    assert.ok(emptyEn.includes('All key requirements in this vacancy are evidenced'));
    assert.ok(emptyEn.includes('No experience or project bullets were found'));
    assert.ok(!emptyEn.includes('sess_empty'));

    const emptyId = buildCvReportText(
      { sessionId: 'sess_empty_id', atsScore: 20, matchedKeywords: [], missingKeywords: [], rewrites: [] },
      'id'
    );
    assert.ok(emptyId.includes('Belum ada kata kunci lowongan'));
    assert.ok(emptyId.includes('Semua kebutuhan utama pada lowongan ini sudah terlihat'));
    assert.ok(emptyId.includes('Belum ada poin pengalaman atau proyek'));
    assert.ok(!emptyId.includes('sess_empty_id'));
  });

  it('getErrorCopy covers all 8 §5 error codes in ID & EN including exact §2 PDF_UNREADABLE and QUOTA_REACHED', () => {
    const allCodes = Object.values(ERROR_CODES);
    assert.equal(allCodes.length, 8);
    assert.equal(Object.keys(ERROR_STATUS).length, 8);

    for (const code of allCodes) {
      const idMsg = getErrorCopy(code, 'id', { action: 'analyze', resetAt: '2026-11-25T17:00:00.000Z' });
      const enMsg = getErrorCopy(code, 'en', { action: 'analyze', resetAt: '2026-11-25T17:00:00.000Z' });
      assert.equal(typeof idMsg, 'string');
      assert.equal(typeof enMsg, 'string');
      assert.ok(idMsg.length > 10, `Empty ID copy for ${code}`);
      assert.ok(enMsg.length > 10, `Empty EN copy for ${code}`);
      assert.notEqual(idMsg, enMsg, `Expected distinct ID and EN copy for ${code}`);
    }

    // Exact §2 copy from guideline.md lines 42-43
    assert.equal(
      getErrorCopy(ERROR_CODES.PDF_UNREADABLE, 'id'),
      'Teks CV belum bisa dibaca. Unggah PDF yang teksnya bisa dipilih atau disalin.'
    );
    assert.equal(
      getErrorCopy(ERROR_CODES.PDF_UNREADABLE, 'en'),
      'We couldn’t read the text in this CV. Upload a PDF with text you can select or copy.'
    );

    // QUOTA_REACHED names action and WIB reset time
    const quotaAnalyzeId = getErrorCopy(ERROR_CODES.QUOTA_REACHED, 'id', {
      action: 'analyze',
      resetAt: '2026-11-25T17:00:00.000Z',
    });
    assert.ok(quotaAnalyzeId.includes('analisis CV'));
    assert.ok(quotaAnalyzeId.includes('WIB'));

    const quotaInterviewEn = getErrorCopy(ERROR_CODES.QUOTA_REACHED, 'en', {
      action: 'interviewStart',
      resetAt: '2026-11-25T17:00:00.000Z',
    });
    assert.ok(quotaInterviewEn.includes('mock interview start'));
    assert.ok(quotaInterviewEn.includes('WIB'));
  });

  it('security regressions: linear EMAIL_RE performance, residual PII formats, and redaction placeholders rejected in keywords', () => {
    // STD-MED-01: 30,000-char contiguous string without '@' must finish fast (no O(n^2) ReDoS).
    const longNoAt = 'a'.repeat(30_000);
    const t0 = Date.now();
    const outLong = redactPii(longNoAt);
    const elapsedMs = Date.now() - t0;
    assert.equal(outLong.length, 30_000);
    assert.ok(elapsedMs < 100, `Expected linear redaction (<100ms), got ${elapsedMs}ms`);

    // SPEC-MED-01: mid-sentence Jl., inline comma Alamat:, 6-6-4 NIK, 2-digit mobile groups.
    const midSentence = redactPii('Saya tinggal di Jl. Melati No. 12 RT 04/RW 02 sejak 2020.');
    assert.ok(!midSentence.includes('Melati'));
    assert.ok(!midSentence.includes('RT 04'));
    assert.ok(midSentence.includes(REDACTION_PLACEHOLDERS.address));
    assert.ok(midSentence.includes('sejak 2020'));

    const inlineComma = redactPii('Email: a@example.com, Alamat: Komp. Griya Asri Blok C4, Depok');
    assert.ok(!inlineComma.includes('a@example.com'));
    assert.ok(!inlineComma.includes('Griya Asri'));
    assert.ok(inlineComma.includes(REDACTION_PLACEHOLDERS.email));
    assert.ok(inlineComma.includes(REDACTION_PLACEHOLDERS.address));

    const nik664 = redactPii('Identitas 317101-120501-0009 terverifikasi');
    assert.ok(!nik664.includes('317101-120501-0009'));
    assert.ok(nik664.includes(REDACTION_PLACEHOLDERS.identity));

    const phone2digit = redactPii('Kontak 0812-34-56-7890 aktif');
    assert.ok(!phone2digit.includes('0812-34-56-7890'));
    assert.ok(phone2digit.includes(REDACTION_PLACEHOLDERS.phone));

    // STD-LOW-03: Redaction placeholder tokens forbidden in matched/missing keywords.
    const badKwMatched = validateAnalysisPayload(
      { ...FIXTURES.en.response, matchedKeywords: ['Python', REDACTION_PLACEHOLDERS.email] },
      FIXTURES.en.cvText
    );
    assert.equal(badKwMatched.ok, false);

    const badKwMissing = validateAnalysisPayload(
      { ...FIXTURES.en.response, missingKeywords: [REDACTION_PLACEHOLDERS.phone] },
      FIXTURES.en.cvText
    );
    assert.equal(badKwMissing.ok, false);
  });
});
