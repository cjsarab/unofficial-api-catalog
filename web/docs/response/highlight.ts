// web/docs/response/highlight.ts
//
// Minimal JSON tokenizer for syntax highlighting in the Raw tab.
// Not a validator — degrades gracefully on malformed input.
// Distinguishes "key" (string followed by a colon) from "string" (all other strings).

export type TokenKind = "punct" | "key" | "string" | "number" | "bool" | "null" | "ws" | "raw";

export interface Token {
  kind: TokenKind;
  text: string;
}

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      let j = i;
      while (j < src.length && /\s/.test(src[j]!)) j++;
      out.push({ kind: "ws", text: src.slice(i, j) });
      i = j;
      continue;
    }

    if (c === "{" || c === "}" || c === "[" || c === "]" || c === "," || c === ":") {
      out.push({ kind: "punct", text: c });
      i++;
      continue;
    }

    if (c === '"') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === '"') { j++; break; }
        j++;
      }
      const text = src.slice(i, j);
      // Peek past whitespace to see if a colon follows → key.
      let k = j;
      while (k < src.length && /\s/.test(src[k]!)) k++;
      const kind: TokenKind = src[k] === ":" ? "key" : "string";
      out.push({ kind, text });
      i = j;
      continue;
    }

    // Number: optional -, digits, optional fractional + exponent.
    const numMatch = src.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (numMatch) {
      out.push({ kind: "number", text: numMatch[0] });
      i += numMatch[0].length;
      continue;
    }

    if (src.startsWith("true", i) || src.startsWith("false", i)) {
      const len = src.startsWith("true", i) ? 4 : 5;
      out.push({ kind: "bool", text: src.slice(i, i + len) });
      i += len;
      continue;
    }

    if (src.startsWith("null", i)) {
      out.push({ kind: "null", text: "null" });
      i += 4;
      continue;
    }

    // Fallback: consume up to the next JSON-structural character or whitespace as raw.
    let j = i;
    while (j < src.length && !/[\s{}[\]:,"]/.test(src[j]!)) j++;
    if (j === i) j++; // ensure forward progress
    out.push({ kind: "raw", text: src.slice(i, j) });
    i = j;
  }

  return out;
}
