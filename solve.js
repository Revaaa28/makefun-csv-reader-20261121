// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader): run(input) returns exactly
// readCsv's {columns, rows, errors} for every input {text, header}, but much faster.
//
// Strategy: most records are plain — no quotes, no stray CRs — so they are taken whole-line:
// find the line end, and when the line holds no '"' and no stray CR, slice it and split(',')
// (native code) instead of walking it a character at a time. Only lines that hold a quote or a
// stray CR fall to the field-by-field path, which scans with indexOf for the next terminator
// instead of reading a character at a time, and only materialises substrings at field ends.
//
// Every branch below follows vendor/csv-reader/index.js (csv-reader 1.0.0) exactly:
//   - U+FEFF at the very start dropped; a line with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next non-doubled quote, "" inside is one quote,
//     each CRLF or lone CR inside reads as LF; text after the closing quote up to the next comma
//     or line break is appended as-is (quote_junk, when the field ends); a quote that never
//     closes is a literal character and the text after it is re-read as unquoted
//     (unterminated_quote); a quote inside an unquoted field is literal;
//   - columns is the first record when header is true, else null; rows are the records after it,
//     each padded with "" (short_row, with fields: its count) or cut (long_row, with extra: the
//     cut fields) to the first record's width;
//   - each error is {code, line, row} in the order met, a record's short_row/long_row when it
//     ends: line the 1-based line its record starts on, counting every LF, CRLF and lone CR
//     inside quotes, row its record's index in rows, null for the header.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;
  // Lazily kept cursors: the next '"' / CR / LF at or after pos (-1: none left). Refreshed only
  // when passed, so the fast path's "does this line hold a quote or a CR" test never re-scans
  // text a record already passed (indexOf has no end bound, and a bare indexOf('"', pos) would
  // run on to the next quote lines ahead, re-scanning the same stretch every record).
  let nextQ = -2;
  let nextR = -2;
  let nextN = -2;

  // Reads unquoted characters onto `init` up to the next comma or line break: a CR not followed
  // by LF is dropped (stray_cr). Sets uVal/uEnd, pos and line. `recordLine` and `recordRow` are
  // the record being read, for the errors it records.
  let recordLine = 1;
  let recordRow = null;
  let uVal = '';
  let uEnd = 0;
  function unq(init, start) {
    let val = init;
    let cur = start;
    for (;;) {
      const ci = text.indexOf(',', cur);
      const ni = text.indexOf('\n', cur);
      if (nextR !== -1 && nextR < cur) nextR = text.indexOf('\r', cur);
      const ri = nextR;
      let m = -1;
      let k = -1;
      if (ci !== -1) {
        m = ci;
        k = 0;
      }
      if (ni !== -1 && (m === -1 || ni < m)) {
        m = ni;
        k = 1;
      }
      if (ri !== -1 && (m === -1 || ri < m)) {
        m = ri;
        k = 2;
      }
      if (m === -1) {
        uVal = val + text.slice(cur);
        pos = n;
        uEnd = END;
        return;
      }
      if (k === 0) {
        uVal = val + text.slice(cur, m);
        pos = m + 1;
        uEnd = COMMA;
        return;
      }
      if (k === 1) {
        uVal = val + text.slice(cur, m);
        pos = m + 1;
        line += 1;
        uEnd = LINE_BREAK;
        return;
      }
      if (text.charCodeAt(m + 1) === 10) {
        uVal = val + text.slice(cur, m);
        pos = m + 2;
        line += 1;
        uEnd = LINE_BREAK;
        return;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      val += text.slice(cur, m);
      cur = m + 1;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the whole record on one line, no quote and no stray CR in it. The line ends at
    // the next LF (or the end of the text); a CR is allowed only as the CRLF that ends it.
    if (nextN !== -1 && nextN < pos) nextN = text.indexOf('\n', pos);
    const nl = nextN;
    const segEnd = nl === -1 ? n : nl;
    if (nextQ !== -1 && nextQ < pos) nextQ = text.indexOf('"', pos);
    if (nextR !== -1 && nextR < pos) nextR = text.indexOf('\r', pos);
    const qi = nextQ;
    if (qi === -1 || qi >= segEnd) {
      const ri = nextR;
      if (ri === -1 || ri >= segEnd) {
        // No quote, no CR: fields are the line split on commas.
        const fields = text.slice(pos, segEnd).split(',');
        pos = nl === -1 ? n : nl + 1;
        if (nl !== -1) line += 1;
        if (width < 0) width = fields.length;
        if (header && columns === null) {
          columns = fields;
          continue;
        }
        if (fields.length < width) {
          errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
          while (fields.length < width) fields.push('');
        } else if (fields.length > width) {
          errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
        }
        rows.push(fields);
        continue;
      }
      if (ri === segEnd - 1) {
        if (nl !== -1) {
          // CRLF ends the line: strip the CR and take the line as above.
          if (segEnd - 1 === pos) {
            // The line held only the CR: no record (the skip loop above already took bare
            // CRLF lines, so this is unreachable, but kept for safety).
            pos = nl + 1;
            line += 1;
            continue;
          }
          const fields = text.slice(pos, segEnd - 1).split(',');
          pos = nl + 1;
          line += 1;
          if (width < 0) width = fields.length;
          if (header && columns === null) {
            columns = fields;
            continue;
          }
          if (fields.length < width) {
            errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
            while (fields.length < width) fields.push('');
          } else if (fields.length > width) {
            errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
          }
          rows.push(fields);
          continue;
        }
        // A lone CR at the very end of the text: dropped (stray_cr); the record stands.
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (segEnd - 1 === pos) {
          // The record held only that CR: no record (its stray_cr error stays).
          pos = n;
          continue;
        }
        const fields = text.slice(pos, segEnd - 1).split(',');
        pos = n;
        if (width < 0) width = fields.length;
        if (header && columns === null) {
          columns = fields;
          continue;
        }
        if (fields.length < width) {
          errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
          while (fields.length < width) fields.push('');
        } else if (fields.length > width) {
          errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
        }
        rows.push(fields);
        continue;
      }
      // A stray CR inside the line: fall through to the field-by-field path.
    }

    // Slow path: the line holds a quote or a stray CR. Read it field by field, as csv-reader
    // does, but scanning with indexOf instead of a character at a time.
    const fields = [];
    let quoted = false;
    let ended;
    for (;;) {
      let value;
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        const open = pos;
        const openLine = line;
        // Find the closing quote, skipping doubled ones.
        let q = text.indexOf('"', pos + 1);
        let doubled = false;
        while (q !== -1 && text.charCodeAt(q + 1) === 34) {
          doubled = true;
          q = text.indexOf('"', q + 2);
        }
        if (q === -1) {
          // The quote never closes: it is a literal character, and the text after it is read
          // again as unquoted.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          unq('"', pos);
          value = uVal;
          ended = uEnd;
        } else {
          const ni2 = nextN;
          const hasNl = ni2 !== -1 && ni2 < q;
          const ri2 = nextR;
          const hasCr = ri2 !== -1 && ri2 < q;
          if (!doubled && !hasNl && !hasCr) {
            value = text.slice(pos + 1, q);
          } else {
            let raw = text.slice(pos + 1, q);
            // Each CRLF or lone CR inside quotes is one LF, and counts one line; each LF one.
            const breaks = raw.match(/\r\n|\r|\n/g);
            if (breaks !== null) line += breaks.length;
            if (hasCr) raw = raw.replace(/\r\n?/g, '\n');
            if (doubled) raw = raw.replaceAll('""', '"');
            value = raw;
          }
          pos = q + 1;
          if (pos >= n) {
            ended = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              ended = COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              ended = LINE_BREAK;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              ended = LINE_BREAK;
            } else {
              // What follows the closing quote is appended as it stands, up to the next comma
              // or line break.
              const before = value.length;
              unq(value, pos);
              value = uVal;
              ended = uEnd;
              if (value.length > before) {
                errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              }
            }
          }
        }
      } else {
        quoted = false;
        unq('', pos);
        value = uVal;
        ended = uEnd;
      }
      fields.push(value);
      if (ended !== COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr
    // errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
