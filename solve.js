// Fast, dependency-free drop-in for make.fun csv-reader 1.0.0.
// The parser slices ordinary runs instead of concatenating one character at a time,
// while preserving the reference reader's intentionally unusual malformed-row rules.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const n = text.length;
  const hasHeader = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let recordLine = 1;
  let recordRow = null;

  function addError(code, extra) {
    if (extra === undefined) errors.push({ code, line: recordLine, row: recordRow });
    else errors.push({ code, line: recordLine, row: recordRow, ...extra });
  }

  function joined(parts) {
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    return parts.join('');
  }

  // Read an unquoted field (or the tail following a closed quoted field).
  // Carriage returns not followed by LF are omitted and reported, as in the reference.
  function readUnquoted(prefix = '') {
    const parts = prefix === '' ? [] : [prefix];
    let appended = 0;
    while (pos < n) {
      const start = pos;
      let i = pos;
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 44 || c === 10 || c === 13) break;
        i++;
      }
      if (i > start) {
        parts.push(text.slice(start, i));
        appended += i - start;
      }
      pos = i;
      if (pos >= n) return { value: joined(parts), ended: END, appended };

      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos++;
        return { value: joined(parts), ended: COMMA, appended };
      }
      if (c === 10) {
        pos++;
        line++;
        return { value: joined(parts), ended: LINE_BREAK, appended };
      }
      if (pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
        return { value: joined(parts), ended: LINE_BREAK, appended };
      }
      addError('stray_cr');
      pos++;
    }
    return { value: joined(parts), ended: END, appended };
  }

  function readQuoted() {
    const open = pos;
    const openLine = line;
    const parts = [];
    let i = pos + 1;
    let chunkStart = i;
    let closed = false;

    while (i < n) {
      const quoteAt = text.indexOf('"', i);
      const crAt = text.indexOf('\r', i);
      const lfAt = text.indexOf('\n', i);
      let next = n;
      if (quoteAt !== -1 && quoteAt < next) next = quoteAt;
      if (crAt !== -1 && crAt < next) next = crAt;
      if (lfAt !== -1 && lfAt < next) next = lfAt;
      if (next >= n) {
        i = n;
        break;
      }

      const c = text.charCodeAt(next);
      if (c === 34) {
        if (next + 1 < n && text.charCodeAt(next + 1) === 34) {
          if (next > chunkStart) parts.push(text.slice(chunkStart, next));
          parts.push('"');
          i = next + 2;
          chunkStart = i;
          continue;
        }
        pos = next + 1;
        closed = true;
        break;
      }

      if (c === 13) {
        if (next > chunkStart) parts.push(text.slice(chunkStart, next));
        parts.push('\n');
        line++;
        i = next + (next + 1 < n && text.charCodeAt(next + 1) === 10 ? 2 : 1);
        chunkStart = i;
        continue;
      }

      // A normal LF remains part of the field but advances the reported source line.
      line++;
      i = next + 1;
    }

    if (!closed) {
      // The reference retries the opening quote as a literal unquoted character.
      pos = open + 1;
      line = openLine;
      addError('unterminated_quote');
      return readUnquoted('"');
    }

    if (pos > chunkStart) parts.push(text.slice(chunkStart, pos - 1));
    const value = joined(parts);
    if (pos >= n) return { value, ended: END };

    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos++;
      return { value, ended: COMMA };
    }
    if (c === 10) {
      pos++;
      line++;
      return { value, ended: LINE_BREAK };
    }
    if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line++;
      return { value, ended: LINE_BREAK };
    }

    const tail = readUnquoted(value);
    if (tail.appended > 0) addError('quote_junk');
    return tail;
  }

  while (true) {
    // Truly blank LF/CRLF lines are skipped. Lone CRs are handled by the field reader.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = hasHeader && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted();
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line containing only stray CR characters is not a record, but its errors remain.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (hasHeader && columns === null) {
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

  return { columns: hasHeader ? (columns ?? []) : null, rows, errors };
}
