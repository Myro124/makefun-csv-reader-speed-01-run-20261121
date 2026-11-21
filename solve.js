// Fast drop-in for csv-reader 1.0.0 (make.fun's own reference program).
// Same answers as readCsv in every case, built from its spec, not from its
// code: one pass, left to right, with the same broken-row policy.
//
// Speed comes from never building a field a character at a time:
//  - a plain field is scanned by char code to its delimiter and sliced
//    once, not concatenated a character at a time;
//  - a quoted field is sliced between its quotes the same way, and only
//    the rare ones (a doubled quote, or a line break inside the quotes)
//    take a transforming pass over their own short segment;
//  - no result object is allocated per field: the field's value and how
//    it ended are written to shared variables;
//  - stray CRs, quote junk and an unterminated quote are all rare, so they
//    take a slow path only when they actually occur.
//
// Ended codes: 0 comma, 1 line break, 2 end of text.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Unquoted field starting at pos, with `base` already in it. `count`
  // counts only the characters this call keeps, for quote_junk.
  // Returns {value, ended, added}.
  // Field results, written by readUnquoted / readQuoted instead of
  // allocating a result object per field (there are ~800k fields a set).
  let fv = '';
  let fe = 2;
  let fa = 0;

  function readUnquoted(base, count) {
    let value = base;
    let added = 0;
    while (pos < n) {
      let p = pos;
      while (p < n) {
        const c = text.charCodeAt(p);
        if (c === 44 || c === 10 || c === 13) break;
        p += 1;
      }
      if (p === n) {
        if (p > pos) { value += text.slice(pos, p); added += p - pos; }
        pos = p;
        fv = value; fe = 2; fa = added;
        return;
      }
      const c = text.charCodeAt(p);
      if (c === 44) {
        if (p > pos) { value += text.slice(pos, p); added += p - pos; }
        pos = p + 1;
        fv = value; fe = 0; fa = added;
        return;
      }
      if (c === 10) {
        if (p > pos) { value += text.slice(pos, p); added += p - pos; }
        pos = p + 1;
        line += 1;
        fv = value; fe = 1; fa = added;
        return;
      }
      if (text.charCodeAt(p + 1) === 10) {
        if (p > pos) { value += text.slice(pos, p); added += p - pos; }
        pos = p + 2;
        line += 1;
        fv = value; fe = 1; fa = added;
        return;
      }
      error('stray_cr');
      if (p > pos) { value += text.slice(pos, p); added += p - pos; }
      pos = p + 1;
    }
    fv = value; fe = 2; fa = added;
  }

  // Quoted field whose opening quote is at pos. Sets fv / fe.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let single = '';
    let singleSet = false;
    let parts = null;
    let p = pos + 1;
    let lineDelta = 0;
    let closeQ = -1;
    while (p < n) {
      const q = text.indexOf('"', p);
      if (q === -1) break;
      if (q > p) {
        let seg = text.slice(p, q);
        if (seg.indexOf('\r') !== -1 || seg.indexOf('\n') !== -1) {
          let cnt = 0;
          seg = seg.replace(/\r\n|\r|\n/g, () => { cnt += 1; return '\n'; });
          lineDelta += cnt;
        }
        if (parts !== null) parts.push(seg);
        else if (singleSet) { parts = [single, seg]; singleSet = false; }
        else { single = seg; singleSet = true; }
      }
      if (text.charCodeAt(q + 1) === 34) {
        if (parts !== null) parts.push('"');
        else if (singleSet) { parts = [single, '"']; singleSet = false; }
        else { single = '"'; singleSet = true; }
        p = q + 2;
        continue;
      }
      closeQ = q;
      break;
    }
    if (closeQ === -1) {
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      readUnquoted('"', false);
      return;
    }
    line += lineDelta;
    pos = closeQ + 1;
    const value = parts !== null ? parts.join('') : singleSet ? single : '';
    if (pos >= n) { fv = value; fe = 2; return; }
    const c = text.charCodeAt(pos);
    if (c === 44) { pos += 1; fv = value; fe = 0; return; }
    if (c === 10) { pos += 1; line += 1; fv = value; fe = 1; return; }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; fv = value; fe = 1; return; }
    readUnquoted(value, true);
    if (fa > 0) error('quote_junk');
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Per-field path (quoted fields, stray CRs, junk, unterminated quotes).
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted(); else readUnquoted('', false);
      fields.push(fv);
    } while (fe === 0);

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; continue; }
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
