/**
 * A tiny, forgiving XML/pseudo-XML parser used to highlight tags inside
 * system prompts and message text and to make matched tag pairs collapsible.
 * It never throws: anything it cannot pair up is emitted as a standalone tag.
 */

export type XmlNode =
  | { type: "text"; value: string }
  | { type: "tag"; raw: string; name: string; form: "open" | "close" | "self" }
  | {
      type: "element";
      name: string;
      openRaw: string;
      closeRaw: string;
      children: XmlNode[];
    };

const TAG_RE = /<\/?[A-Za-z][\w:.-]*(?:\s[^<>]*?)?\/?>/g;

interface Token {
  kind: "text" | "tag";
  raw: string;
  name: string;
  form: "open" | "close" | "self";
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text)) !== null) {
    if (m.index > last) {
      tokens.push({ kind: "text", raw: text.slice(last, m.index), name: "", form: "open" });
    }
    const raw = m[0];
    const isClose = raw.startsWith("</");
    const isSelf = raw.endsWith("/>");
    const nameMatch = /^<\/?\s*([A-Za-z][\w:.-]*)/.exec(raw);
    tokens.push({
      kind: "tag",
      raw,
      name: nameMatch ? nameMatch[1] : "",
      form: isClose ? "close" : isSelf ? "self" : "open",
    });
    last = m.index + raw.length;
  }
  if (last < text.length) {
    tokens.push({ kind: "text", raw: text.slice(last), name: "", form: "open" });
  }
  return tokens;
}

/** Parse text into a tree of text / standalone tags / matched elements. */
export function parseXml(text: string): XmlNode[] {
  const tokens = tokenize(text);
  let i = 0;

  function parseChildren(stopName: string | null): XmlNode[] {
    const nodes: XmlNode[] = [];
    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok.kind === "text") {
        nodes.push({ type: "text", value: tok.raw });
        i++;
        continue;
      }
      if (tok.form === "close") {
        if (stopName !== null && tok.name === stopName) return nodes;
        nodes.push({ type: "tag", raw: tok.raw, name: tok.name, form: "close" });
        i++;
        continue;
      }
      if (tok.form === "self") {
        nodes.push({ type: "tag", raw: tok.raw, name: tok.name, form: "self" });
        i++;
        continue;
      }
      // open tag — try to pair it with a matching close
      const open = tok;
      i++;
      const afterOpen = i;
      const children = parseChildren(open.name);
      const close = tokens[i];
      if (close && close.kind === "tag" && close.form === "close" && close.name === open.name) {
        i++;
        nodes.push({
          type: "element",
          name: open.name,
          openRaw: open.raw,
          closeRaw: close.raw,
          children,
        });
      } else {
        // no matching close — emit the open tag alone and resume after it
        i = afterOpen;
        nodes.push({ type: "tag", raw: open.raw, name: open.name, form: "open" });
      }
    }
    return nodes;
  }

  return parseChildren(null);
}

/** True when the text contains at least one tag worth highlighting. */
export function hasTags(text: string): boolean {
  TAG_RE.lastIndex = 0;
  return TAG_RE.test(text);
}
