// Client-safe PII redaction engine (guideline.md §8). Zero Node-only imports.

export const REDACTION_PLACEHOLDERS = Object.freeze({
  email: '[EMAIL_REDACTED]',
  phone: '[PHONE_REDACTED]',
  identity: '[IDENTITY_REDACTED]',
  address: '[ADDRESS_REDACTED]',
});

const EMAIL_RE =
  /(?:mailto:|(?<![a-zA-Z0-9._%+-]))[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,255}\.[a-zA-Z]{2,24}\b/gi;

// 16-digit Indonesian NIK (contiguous, 6-6-4 administrative, or 4x4 grouped).
const NIK_16_RE =
  /\b(?:\d{16}|\d{6}[ .-]\d{6}[ .-]\d{4}|\d{4}[ .-]?\d{4}[ .-]?\d{4}[ .-]?\d{4})\b/g;

// Labeled national/government IDs (NIK, KTP, No. KTP, National ID, ID Number).
// Matches grouped numeric IDs or single-token alphanumeric IDs containing digits without swallowing trailing words.
const ID_VALUE_PATTERN =
  '(?:\\d{4,20}(?:[ .-]+\\d{2,8}){0,4}|(?=[A-Za-z0-9./-]*\\d)[A-Za-z0-9]+(?:[./-][A-Za-z0-9]+)*)';
const LABELED_ID_COLON_RE = new RegExp(
  `(\\b(?:no\\.?[ \\t]*ktp|nomor[ \\t]+ktp|nomor[ \\t]+induk[ \\t]+kependudukan|nik|ktp|national[ \\t]+id(?:[ \\t]+(?:no\\.?|number))?|id[ \\t]+(?:no\\.?|number))\\b[ \\t]*[:=][ \\t]*)(${ID_VALUE_PATTERN})\\b`,
  'gi'
);
const LABELED_ID_SPACE_RE = new RegExp(
  `(\\b(?:no\\.?[ \\t]*ktp|nomor[ \\t]+ktp|nomor[ \\t]+induk[ \\t]+kependudukan|nik|ktp|national[ \\t]+id(?:[ \\t]+(?:no\\.?|number))?|id[ \\t]+number)\\b[ \\t]+)(\\d{4,20}(?:[ .-]+\\d{2,8}){0,4})\\b`,
  'gi'
);

const MONTH_PATTERN =
  '(?:Jan(?:uari|uary)?|Feb(?:ruari|ruary)?|Mar(?:et|ch)?|Apr(?:il)?|Mei|May|Jun(?:i|e)?|Jul(?:i|y)?|Agu(?:stus)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Okt(?:ober)?|Oct(?:ober)?|Nov(?:ember)?|Des(?:ember)?|Dec(?:ember)?)';

const DATE_VALUE_PATTERN =
  `(?:[A-Za-z .'-]{2,35}[ \\t]*[,/][ \\t]*)?` +
  `(?:` +
  `\\d{1,2}[ \\t./-]+${MONTH_PATTERN}[ \\t,./-]+\\d{2,4}` +
  `|${MONTH_PATTERN}[ \\t]+\\d{1,2},?[ \\t]+\\d{4}` +
  `|\\d{1,2}[ \\t./-]\\d{1,2}[ \\t./-]\\d{2,4}` +
  `|\\d{4}[ \\t./-]\\d{1,2}[ \\t./-]\\d{1,2}` +
  `)`;

const BIRTH_LABEL_PATTERN =
  '(?:tempat[ \\t]*(?:,|\\/|&|dan)[ \\t]*(?:tanggal|tgl\\.?)[ \\t]+lahir|(?:tanggal|tgl\\.?)[ \\t]+lahir|ttl|(?:place[ \\t]*(?:,|\\/|&|and)[ \\t]*)?date[ \\t]+of[ \\t]+birth|birth[ \\t]*date|d\\.?o\\.?b\\.?)';

const LABELED_BIRTH_COLON_RE = new RegExp(
  `(\\b${BIRTH_LABEL_PATTERN}\\b[ \\t]*[:=][ \\t]*)(?:${DATE_VALUE_PATTERN}|(?:[A-Za-z .'-]{2,35}[ \\t]*[,/][ \\t]*)?(?:19|20)\\d{2}\\b)`,
  'gi'
);
const LABELED_BIRTH_SPACE_RE = new RegExp(
  `(\\b(?:${BIRTH_LABEL_PATTERN}|born(?:[ \\t]+in)?)\\b(?:[ \\t]*[:=][ \\t]*|[ \\t]+))(${DATE_VALUE_PATTERN})`,
  'gi'
);

// Phone patterns: labeled, international (+62/+1/...), Indonesian local (08xx, (021), 021-), and NANP.
const LABELED_PHONE_RE =
  /(\b(?:no\.?[ \t]*(?:hp|telp(?:on)?|telepon|wa|whatsapp)|hp|wa|whatsapp|telp(?:on)?|telepon|phone|mobile|handphone|tel)\b[ \t]*[:=][ \t]*)(\+?\(?\d{1,4}\)?(?:[ \t.-]*\(?\d{2,5}\)?){1,4})(?![A-Za-z0-9%])/gi;
const LABELED_PHONE_SPACE_RE =
  /(\b(?:no\.?[ \t]*(?:hp|telp(?:on)?|telepon|wa|whatsapp)|hp|wa|whatsapp|telp(?:on)?|telepon|phone|mobile|handphone)\b[ \t]+)(\+?\(?\d{1,4}\)?(?:[ \t.-]*\(?\d{2,5}\)?){1,4})(?![A-Za-z0-9%])/gi;
const INTL_PHONE_RE =
  /(?<![A-Za-z0-9])(?:\(\+\d{1,3}\)|\+\d{1,3})[ \t.-]*(?:\(\d{1,4}\)[ \t.-]*|\d{1,4}[ \t.-]*){1,4}\d{2,6}(?![A-Za-z0-9%])/g;
const ID_MOBILE_RE = /\b08\d{1,3}(?:[ \t.-]?\d{2,5}){1,4}\b(?![%])/g;
const ID_AREA_PAREN_RE = /(?<![A-Za-z0-9])\(0\d{2,3}\)[ \t.-]*\d{3,8}(?:[ \t.-]*\d{2,5}){0,2}\b(?![%])/g;
const ID_AREA_SEP_RE = /\b0[2-79]\d{1,2}[ \t-]\d{3,8}(?:[ \t-]\d{2,5}){0,2}\b(?![%])/g;
const NANP_PHONE_RE = /(?<![A-Za-z0-9.-])(?:\(\d{3}\)[ \t.-]*|\d{3}[ \t.-])\d{3}[ \t.-]\d{4}\b(?![.%])/g;

// Address detection helpers (line & column aware).
const LABELED_ADDR_SEGMENT_RE =
  /^([ \t]*(?!(?:email|e-mail|web|ip|mac|url|memory)[ \t]+address\b)((?:alamat(?:[ \t]+(?:rumah|domisili|lengkap))?|domisili|home[ \t]+address|street[ \t]+address|residential[ \t]+address|current[ \t]+address|mailing[ \t]+address|address|residence))[ \t]*[:=][ \t]*)(.*)$/i;

const LABELED_ADDR_NOCOLON_RE =
  /^([ \t]*\b(?:alamat[ \t]+(?:rumah|domisili)|home[ \t]+address)\b[ \t]+)(.+)$/i;

const TABLE_ADDR_LABEL_ONLY_RE =
  /^[ \t]*(?:alamat(?:[ \t]+(?:rumah|domisili|lengkap))?|domisili|home[ \t]+address|address|residence)[ \t]*[:=]?[ \t]*$/i;

const SECTION_HEADER_RE =
  /^[ \t]*(?:(?:work[ \t]+|professional[ \t]+)?experience|pengalaman(?:[ \t]+(?:kerja|organisasi))?|education|pendidikan|riwayat[ \t]+pendidikan|(?:technical[ \t]+|core[ \t]+)?skills?|keahlian|keterampilan|projects?|proyek|pengalaman[ \t]+proyek|(?:professional[ \t]+)?summary|ringkasan|profil(?:e)?|tentang[ \t]+saya|about(?:[ \t]+me)?|certifications?|sertifikasi|organizations?|organisasi|achievements?|prestasi|languages?|bahasa|internship|magang|volunteer(?:ing)?|employment|work[ \t]+history)[ \t]*[:=]?\s*$/i;

const OTHER_CONTACT_LABEL_RE =
  /^[ \t]*(?:email|e-mail|phone|mobile|telp(?:on)?|telepon|hp|wa|whatsapp|linkedin|github|portfolio|website|nik|ktp|no\.?[ \t]*ktp|ttl|(?:tempat[ \t]*[,/][ \t]*)?(?:tanggal|tgl\.?)[ \t]+lahir|birthdate|date[ \t]+of[ \t]+birth|dob)\b/i;

const NON_ADDRESS_ROLE_OR_DATE_RE =
  /\b(?:intern|internship|magang|analyst|analis|engineer|developer|designer|manager|specialist|assistant|associate|coordinator|consultant|officer|administrator|programmer|accountant|akuntan|recruiter|graduated|lulus|class[ \t]+of|gpa|ipk|bachelor|sarjana|diploma|universitas|university|institut|politeknik)\b|\b(?:19|20)\d{2}[ \t]*[-–—][ \t]*(?:(?:19|20)\d{2}|present|sekarang|current)\b/i;

const ADDRESS_CONTINUATION_HINT_RE =
  /\b(?:jl\.?|jln\.?|jalan|gg\.?|gang|rt\.?[ \t]*\d+|rw\.?[ \t]*\d+|kel\.?|kelurahan|kec\.?|kecamatan|kab\.?|kabupaten|kota|desa|dusun|blok[ \t]+[A-Za-z0-9-]+|no\.?[ \t]*\d+[A-Za-z]?|kav\.?|kavling|komp\.?|komplek|perum(?:ahan)?|apt\.?|apartemen|apartment|suite|unit|lantai|lt\.?[ \t]*\d+|kode[ \t]*pos|postal[ \t]*code|zip[ \t]*code|street|st\.|avenue|ave\.|road|rd\.|boulevard|blvd\.)\b|\b(?:jakarta(?:[ \t]+(?:selatan|pusat|barat|timur|utara))?|bandung|surabaya|medan|bekasi|tangerang(?:[ \t]+selatan)?|depok|semarang|palembang|makassar|bogor|batam|pekanbaru|malang|yogyakarta|sleman|bantul|surakarta|solo|denpasar|balikpapan|samarinda|pontianak|banjarmasin|manado|padang|jawa[ \t]+(?:barat|tengah|timur)|dki[ \t]+jakarta|di[ \t]+yogyakarta|banten|bali)\b(?:[^\n]*\b\d{5}\b)?|^[ \t]*(?:kode[ \t]*pos[ \t]*[:=]?[ \t]*)?\d{5}[ \t]*$/i;

const INLINE_LABELED_ADDR_RE =
  /([,;][ \t]+(?!(?:email|e-mail|web|ip|mac|url|memory)[ \t]+address\b)(?:alamat(?:[ \t]+(?:rumah|domisili|lengkap))?|domisili|home[ \t]+address|street[ \t]+address|residential[ \t]+address|current[ \t]+address|mailing[ \t]+address|address|residence)[ \t]*[:=][ \t]*)(.+)$/i;

// Unlabeled Indonesian street lines: Jl. / Jln. / Jalan + street name + house/RT/RW/Kav/Blok/postal indicator (EOL or mid-sentence).
const UNLABELED_ID_STREET_RE =
  /(^|[ \t(])((?:Jl\.|Jln\.|Jalan)[ \t]+[A-Z0-9][A-Za-z0-9 .,'/-]{1,85}?(?:\b(?:No\.?[ \t]*\d+[A-Za-z]?(?:[ \t]+RT\.?[ \t]*\d+(?:[ \t/]+RW\.?[ \t]*\d+)?)?|RT\.?[ \t]*\d+(?:[ \t/]+RW\.?[ \t]*\d+)?|RW\.?[ \t]*\d+|Blok[ \t]+[A-Za-z0-9-]+|Kav\.?[ \t]*\d+|Kel\.?[ \t]+[A-Za-z]+|Kec\.?[ \t]+[A-Za-z]+|Kode[ \t]*Pos[ \t]*\d{5}|\d{5})\b(?:[ \t]*,[ \t]*[A-Za-z0-9 .'-]{1,44}[A-Za-z0-9]){0,3}))(?=[.,;!?)]*(?:$|[ \t]))/gim;

const UNLABELED_JL_NUMBER_RE =
  /(^|[ \t(])((?:Jl\.|Jln\.)[ \t]+[A-Z][A-Za-z .'-]{2,40}[ \t]+\d{1,4}[A-Za-z]?(?:[ \t]*,[ \t]*[A-Za-z0-9 .'-]{1,44}[A-Za-z0-9]){0,3})(?=[.,;!?)]*(?:$|[ \t]))/gm;

function countDigits(str) {
  const m = str.match(/\d/g);
  return m ? m.length : 0;
}

function isAddressContinuationSegment(segment) {
  const trimmed = segment.trim();
  if (!trimmed) return false;
  if (/^[-*•·▪▸◦‣]\s|^\d+[.)]\s/.test(trimmed)) return false;
  if (SECTION_HEADER_RE.test(trimmed)) return false;
  if (OTHER_CONTACT_LABEL_RE.test(trimmed)) return false;
  if (NON_ADDRESS_ROLE_OR_DATE_RE.test(trimmed)) return false;
  return ADDRESS_CONTINUATION_HINT_RE.test(trimmed);
}

function splitPreservingDelimiters(line) {
  // Split a line by column/header delimiters (\t, ' | ', ' • ', ' · ') while preserving delimiters.
  const parts = [];
  const delimRe = /(\t+|[ \t]+[|•·][ \t]+)/g;
  let lastIndex = 0;
  let match;
  while ((match = delimRe.exec(line)) !== null) {
    parts.push({ type: 'seg', text: line.slice(lastIndex, match.index) });
    parts.push({ type: 'delim', text: match[0] });
    lastIndex = match.index + match[0].length;
  }
  parts.push({ type: 'seg', text: line.slice(lastIndex) });
  return parts;
}

function redactAddresses(text) {
  const lines = text.split('\n');
  const outLines = [];
  let inMultilineAddress = false;
  let pendingLabelLineIdx = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      inMultilineAddress = false;
      pendingLabelLineIdx = -1;
      outLines.push(line);
      continue;
    }

    // Handle multi-line address continuation before other segments.
    if (inMultilineAddress) {
      const parts = splitPreservingDelimiters(line);
      const firstSeg = parts[0].text;
      if (isAddressContinuationSegment(firstSeg)) {
        if (pendingLabelLineIdx >= 0) {
          outLines[pendingLabelLineIdx] = `${outLines[pendingLabelLineIdx]} ${REDACTION_PLACEHOLDERS.address}`;
          pendingLabelLineIdx = -1;
        }
        if (parts.length === 1) {
          // Whole line was a continuation of the previous address block; omit line so block collapses cleanly.
          continue;
        }
        // Two-column PDF where left column continued the address and right column has independent content!
        parts[0].text = '';
        const rest = parts
          .slice(1)
          .map((p) => p.text)
          .join('')
          .replace(/^\t+/, '\t');
        outLines.push(rest);
        continue;
      }
      inMultilineAddress = false;
      pendingLabelLineIdx = -1;
    }

    const parts = splitPreservingDelimiters(line);
    let startedAddressOnFirstSeg = false;
    let emptyValueLabelOnOnlySeg = false;

    for (let p = 0; p < parts.length; p += 1) {
      if (parts[p].type !== 'seg') continue;
      const seg = parts[p].text;

      // Table layout: [Alamat] \t [Jl. Melati No. 12]
      if (
        TABLE_ADDR_LABEL_ONLY_RE.test(seg) &&
        p + 2 < parts.length &&
        parts[p + 1].text.includes('\t') &&
        parts[p + 2].type === 'seg'
      ) {
        const nextVal = parts[p + 2].text.trim();
        if (nextVal && nextVal !== ':' && !SECTION_HEADER_RE.test(nextVal)) {
          if (nextVal.startsWith(':')) {
            parts[p + 2].text = `: ${REDACTION_PLACEHOLDERS.address}`;
          } else {
            parts[p + 2].text = REDACTION_PLACEHOLDERS.address;
          }
          if (p === 0) startedAddressOnFirstSeg = true;
          p += 2;
          continue;
        }
      }

      const colonMatch = seg.match(LABELED_ADDR_SEGMENT_RE);
      if (colonMatch) {
        const prefix = colonMatch[1];
        const value = colonMatch[3].trim();
        if (!value && parts.length === 1) {
          parts[p].text = prefix.trimEnd();
          emptyValueLabelOnOnlySeg = true;
          startedAddressOnFirstSeg = true;
        } else if (value) {
          parts[p].text = `${prefix}${REDACTION_PLACEHOLDERS.address}`;
          if (p === 0) startedAddressOnFirstSeg = true;
        }
        continue;
      }

      const noColonMatch = seg.match(LABELED_ADDR_NOCOLON_RE);
      if (noColonMatch && !NON_ADDRESS_ROLE_OR_DATE_RE.test(noColonMatch[2])) {
        parts[p].text = `${noColonMatch[1]}${REDACTION_PLACEHOLDERS.address}`;
        if (p === 0) startedAddressOnFirstSeg = true;
        continue;
      }

      const inlineColonMatch = seg.match(INLINE_LABELED_ADDR_RE);
      if (inlineColonMatch) {
        parts[p].text = seg.replace(
          INLINE_LABELED_ADDR_RE,
          (_, prefix) => `${prefix}${REDACTION_PLACEHOLDERS.address}`
        );
        if (p === 0) startedAddressOnFirstSeg = true;
        continue;
      }

      // Unlabeled Indonesian street segment.
      let replaced = seg.replace(
        UNLABELED_ID_STREET_RE,
        (_, lead) => `${lead}${REDACTION_PLACEHOLDERS.address}`
      );
      replaced = replaced.replace(
        UNLABELED_JL_NUMBER_RE,
        (_, lead) => `${lead}${REDACTION_PLACEHOLDERS.address}`
      );
      if (replaced !== seg && p === 0) {
        startedAddressOnFirstSeg = true;
      }
      parts[p].text = replaced;
    }

    outLines.push(parts.map((pt) => pt.text).join(''));
    if (startedAddressOnFirstSeg) {
      inMultilineAddress = true;
      if (emptyValueLabelOnOnlySeg) {
        pendingLabelLineIdx = outLines.length - 1;
      }
    }
  }

  return outLines.join('\n');
}

export function redactPii(text) {
  if (typeof text !== 'string' || text.length === 0) return '';

  let result = text.replace(/\r\n?/g, '\n');

  // Mask labeled names and recognizable profile links without guessing names in work history.
  result = result.replace(/^([ \t]*(?:nama(?: lengkap)?|(?:full )?name)[ \t]*:[ \t]*)[^\n\t|;,]+/gim, '$1[IDENTITY_REDACTED]');
  result = result.replace(/\b(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w%.-]+[^\s<>)]*/gi, '[IDENTITY_REDACTED]');

  // 1. Emails (including mailto: and plus-tags). Fast-path guard prevents scanning strings without '@'.
  if (result.includes('@')) {
    result = result.replace(EMAIL_RE, REDACTION_PLACEHOLDERS.email);
  }

  // 2. Identity: labeled IDs, 16-digit NIKs, and labeled birthdates (before phone so 16-digit NIKs never match phone).
  result = result.replace(
    LABELED_ID_COLON_RE,
    (_, prefix) => `${prefix}${REDACTION_PLACEHOLDERS.identity}`
  );
  result = result.replace(
    LABELED_ID_SPACE_RE,
    (_, prefix) => `${prefix}${REDACTION_PLACEHOLDERS.identity}`
  );
  result = result.replace(NIK_16_RE, REDACTION_PLACEHOLDERS.identity);
  result = result.replace(
    LABELED_BIRTH_COLON_RE,
    (_, prefix) => `${prefix}${REDACTION_PLACEHOLDERS.identity}`
  );
  result = result.replace(
    LABELED_BIRTH_SPACE_RE,
    (_, prefix) => `${prefix}${REDACTION_PLACEHOLDERS.identity}`
  );

  // 3. Home addresses (labeled single/multi-line & unlabeled Indonesian street lines).
  result = redactAddresses(result);

  // 4. Phones: labeled, international, Indonesian mobile/landline, and NANP without matching years/GPAs/metrics.
  result = result.replace(LABELED_PHONE_RE, (full, prefix, num) => {
    const digits = countDigits(num);
    return digits >= 7 && digits <= 15 ? `${prefix}${REDACTION_PLACEHOLDERS.phone}` : full;
  });
  result = result.replace(LABELED_PHONE_SPACE_RE, (full, prefix, num) => {
    const digits = countDigits(num);
    return digits >= 7 && digits <= 15 ? `${prefix}${REDACTION_PLACEHOLDERS.phone}` : full;
  });
  result = result.replace(INTL_PHONE_RE, (full) => {
    const digits = countDigits(full);
    return digits >= 8 && digits <= 15 ? REDACTION_PLACEHOLDERS.phone : full;
  });
  result = result.replace(ID_MOBILE_RE, (full) => {
    const digits = countDigits(full);
    return digits >= 9 && digits <= 14 ? REDACTION_PLACEHOLDERS.phone : full;
  });
  result = result.replace(ID_AREA_PAREN_RE, (full) => {
    const digits = countDigits(full);
    return digits >= 8 && digits <= 13 ? REDACTION_PLACEHOLDERS.phone : full;
  });
  result = result.replace(ID_AREA_SEP_RE, (full) => {
    const digits = countDigits(full);
    return digits >= 8 && digits <= 13 ? REDACTION_PLACEHOLDERS.phone : full;
  });
  result = result.replace(NANP_PHONE_RE, REDACTION_PLACEHOLDERS.phone);

  return result;
}

export function redactAnalysisOutput(analysis) {
  if (!analysis || typeof analysis !== 'object') return analysis;

  const out = { ...analysis };

  if (Array.isArray(analysis.matchedKeywords)) {
    out.matchedKeywords = analysis.matchedKeywords.map((item) =>
      typeof item === 'string' ? redactPii(item).trim() : item
    );
  }

  if (Array.isArray(analysis.missingKeywords)) {
    out.missingKeywords = analysis.missingKeywords.map((item) =>
      typeof item === 'string' ? redactPii(item).trim() : item
    );
  }

  if (Array.isArray(analysis.rewrites)) {
    out.rewrites = analysis.rewrites.map((rw) => {
      if (!rw || typeof rw !== 'object') return rw;
      return {
        ...rw,
        original: typeof rw.original === 'string' ? redactPii(rw.original).trim() : rw.original,
        improved: typeof rw.improved === 'string' ? redactPii(rw.improved).trim() : rw.improved,
        reason: typeof rw.reason === 'string' ? redactPii(rw.reason).trim() : rw.reason,
      };
    });
  }

  return out;
}
