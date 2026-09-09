type SqlState = "NORMAL" | "SINGLE_QUOTE" | "DOUBLE_QUOTE" | "BACKTICK" | "LINE_COMMENT" | "BLOCK_COMMENT";

// MariaDB client 전용 DELIMITER 지시문을 제거하면서 서버에 보낼 실행 batch를 만든다.
// 기본 ';' 구간은 기존 multipleStatements batch 의미를 보존하고, 사용자 delimiter 구간만 문장별로 분리한다.
export function createMigrationSqlBatches(sql: string): string[] {
  const batches: string[] = [];
  let buffer = "";
  let delimiter = ";";
  let state: SqlState = "NORMAL";
  let hasSql = false;
  let lineStart = true;

  const flush = (): void => {
    if (hasSql) batches.push(buffer.trim());
    buffer = "";
    hasSql = false;
  };

  for (let index = 0; index < sql.length;) {
    if (state === "NORMAL" && lineStart) {
      const lineEnd = sql.indexOf("\n", index);
      const end = lineEnd === -1 ? sql.length : lineEnd;
      const line = sql.slice(index, end).replace(/\r$/, "");
      const directive = /^\s*DELIMITER(?:\s+(\S+))?\s*$/i.exec(line);
      if (directive !== null) {
        const nextDelimiter = directive[1];
        if (nextDelimiter === undefined || nextDelimiter.length > 16 || /[\0\r\n]/.test(nextDelimiter)) throw new Error("MIGRATION_DELIMITER_DIRECTIVE_INVALID");
        if (delimiter !== ";" && hasSql) throw new Error("MIGRATION_SQL_UNTERMINATED_STATEMENT");
        flush();
        delimiter = nextDelimiter;
        index = lineEnd === -1 ? sql.length : lineEnd + 1;
        lineStart = true;
        continue;
      }
    }

    if (state === "NORMAL" && delimiter !== ";" && sql.startsWith(delimiter, index)) {
      flush();
      index += delimiter.length;
      lineStart = false;
      continue;
    }

    const current = sql[index]!;
    const next = sql[index + 1];
    buffer += current;

    if (state === "NORMAL") {
      if (current === "'" || current === '"' || current === "`") {
        state = current === "'" ? "SINGLE_QUOTE" : current === '"' ? "DOUBLE_QUOTE" : "BACKTICK";
        hasSql = true;
      } else if (current === "#") {
        state = "LINE_COMMENT";
      } else if (current === "-" && next === "-" && (sql[index + 2] === undefined || /\s/.test(sql[index + 2]!))) {
        buffer += next;
        index += 1;
        state = "LINE_COMMENT";
      } else if (current === "/" && next === "*") {
        buffer += next;
        index += 1;
        state = "BLOCK_COMMENT";
      } else if (!/\s/.test(current)) {
        hasSql = true;
      }
    } else if (state === "LINE_COMMENT") {
      if (current === "\n") state = "NORMAL";
    } else if (state === "BLOCK_COMMENT") {
      if (current === "*" && next === "/") {
        buffer += next;
        index += 1;
        state = "NORMAL";
      }
    } else {
      const quote = state === "SINGLE_QUOTE" ? "'" : state === "DOUBLE_QUOTE" ? '"' : "`";
      if (current === "\\" && next !== undefined) {
        buffer += next;
        index += 1;
      } else if (current === quote && next === quote) {
        buffer += next;
        index += 1;
      } else if (current === quote) {
        state = "NORMAL";
      }
    }

    lineStart = current === "\n" ? true : lineStart && /[ \t\r]/.test(current);
    index += 1;
  }

  if (state === "SINGLE_QUOTE" || state === "DOUBLE_QUOTE" || state === "BACKTICK" || state === "BLOCK_COMMENT") throw new Error("MIGRATION_SQL_UNTERMINATED_LITERAL_OR_COMMENT");
  if (delimiter !== ";" && hasSql) throw new Error("MIGRATION_SQL_UNTERMINATED_STATEMENT");
  flush();
  return batches;
}
