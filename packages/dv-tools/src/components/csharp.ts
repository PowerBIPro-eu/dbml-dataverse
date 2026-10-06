// A small C# reader for plug-in registration code: tokens, namespaces, usings, type declarations
// and their members. It reads declarations only and evaluates nothing but literals; whatever it
// cannot read is reported to the caller, never guessed.

export type TokenKind = 'ident' | 'number' | 'string' | 'char' | 'punct';

export interface Token {
  kind: TokenKind;
  text: string;
  /** Strings: the decoded value; null for an interpolated string with holes. */
  value?: string | null;
}

const PUNCT2 = new Set(['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '::', '++', '--', '+=', '-=', '*=', '/=']);
const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'", a: '\x07', b: '\b', f: '\f', v: '\v' };

// ASCII first: generated early-bound model files are large
const isIdentStart = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || (c > '\x7f' && /\p{L}/u.test(c));
const isIdentPart = (c: string) => isIdentStart(c) || (c >= '0' && c <= '9') || (c > '\x7f' && /\p{N}/u.test(c));

export class CSharpSyntaxError extends Error {}

/** Tokens of a C# source file; comments, whitespace and preprocessor lines are skipped. */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let lineStart = true;
  const n = src.length;

  /** Read a quoted string whose content starts at `start` (after the prefix and the quote); returns the index after it. */
  const readQuoted = (tokenStart: number, start: number, verbatim: boolean, interpolated: boolean): number => {
    let j = start;
    let value = '';
    let holes = false;
    for (;;) {
      if (j >= n) throw new CSharpSyntaxError('unterminated string');
      const c = src[j];
      if (c === '"') {
        if (verbatim && src[j + 1] === '"') { value += '"'; j += 2; continue; }
        j++;
        break;
      }
      if (!verbatim && c === '\\') {
        const e = src[j + 1];
        if (e === 'u') { value += String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16)); j += 6; continue; }
        value += ESCAPES[e] ?? e;
        j += 2;
        continue;
      }
      if (!verbatim && (c === '\n' || c === '\r')) throw new CSharpSyntaxError('newline in string');
      if (interpolated && c === '{') {
        if (src[j + 1] === '{') { value += '{'; j += 2; continue; }
        holes = true;
        // skip the hole, nested braces and strings included
        let depth = 0;
        for (; j < n; j++) {
          if (src[j] === '{') depth++;
          else if (src[j] === '}' && --depth === 0) break;
          else if (src[j] === '"') { j++; while (j < n && src[j] !== '"') j += src[j] === '\\' ? 2 : 1; }
        }
        j++;
        continue;
      }
      if (interpolated && c === '}' && src[j + 1] === '}') { value += '}'; j += 2; continue; }
      value += c;
      j++;
    }
    tokens.push({ kind: 'string', text: src.slice(tokenStart, j), value: holes ? null : value });
    return j;
  };

  while (i < n) {
    const c = src[i];
    if (c === '\n') { lineStart = true; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || /\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new CSharpSyntaxError('unterminated comment');
      i = end + 2;
      continue;
    }
    if (c === '#' && lineStart) { while (i < n && src[i] !== '\n') i++; continue; }
    lineStart = false;

    // raw string literals ("""…"""), optionally interpolated
    const rawStart = src.startsWith('$"""', i) ? i + 1 : src.startsWith('"""', i) ? i : -1;
    if (rawStart >= 0) {
      let quotes = 0;
      while (src[rawStart + quotes] === '"') quotes++;
      const close = src.indexOf('"'.repeat(quotes), rawStart + quotes);
      if (close < 0) throw new CSharpSyntaxError('unterminated raw string');
      const body = src.slice(rawStart + quotes, close);
      const interpolated = rawStart > i;
      tokens.push({ kind: 'string', text: src.slice(i, close + quotes), value: interpolated && body.includes('{') ? null : rawStringValue(body) });
      i = close + quotes;
      continue;
    }
    if (c === '"') { i = readQuoted(i, i + 1, false, false); continue; }
    if (c === '@' && src[i + 1] === '"') { i = readQuoted(i, i + 2, true, false); continue; }
    if (c === '$' && src[i + 1] === '"') { i = readQuoted(i, i + 2, false, true); continue; }
    if ((c === '$' && src[i + 1] === '@' && src[i + 2] === '"') || (c === '@' && src[i + 1] === '$' && src[i + 2] === '"')) {
      i = readQuoted(i, i + 3, true, true);
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== "'") j += src[j] === '\\' ? 2 : 1;
      tokens.push({ kind: 'char', text: src.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (c === '@' && isIdentStart(src[i + 1] ?? '')) i++;   // verbatim identifier
    if (isIdentStart(src[i])) {
      let j = i + 1;
      while (j < n && isIdentPart(src[j])) j++;
      tokens.push({ kind: 'ident', text: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9a-zA-Z_]/.test(src[j])) j++;
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] ?? '')) { j++; while (j < n && /[0-9a-zA-Z_]/.test(src[j])) j++; }
      tokens.push({ kind: 'number', text: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (PUNCT2.has(two)) { tokens.push({ kind: 'punct', text: two }); i += 2; continue; }
    tokens.push({ kind: 'punct', text: c });
    i++;
  }
  return tokens;
}

/** A raw string's value: single-line as is; multi-line without its first and last line, dedented by the last. */
function rawStringValue(body: string): string {
  if (!body.includes('\n')) return body;
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const indent = lines[lines.length - 1];
  return lines.slice(1, -1).map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart())).join('\n');
}

// ── Brackets ───────────────────────────────────────────────────────────────

const OPEN: Record<string, string> = { '{': '}', '(': ')', '[': ']' };

/** Index of the matching bracket for every opening bracket. */
export function matchBrackets(tokens: Token[]): Map<number, number> {
  const match = new Map<number, number>();
  const stack: number[] = [];
  tokens.forEach((t, i) => {
    if (t.kind !== 'punct') return;
    if (OPEN[t.text]) stack.push(i);
    else if (t.text === '}' || t.text === ')' || t.text === ']') {
      const open = stack.pop();
      if (open === undefined || OPEN[tokens[open].text] !== t.text) throw new CSharpSyntaxError(`unbalanced '${t.text}'`);
      match.set(open, i);
    }
  });
  if (stack.length) throw new CSharpSyntaxError(`unclosed '${tokens[stack[stack.length - 1]].text}'`);
  return match;
}

// ── Declarations ───────────────────────────────────────────────────────────

export interface CSharpFile {
  path: string;
  tokens: Token[];
  match: Map<number, number>;
}

export interface TypeDecl {
  name: string;
  fullName: string;              // namespace + enclosing types + name, dot-separated
  kind: 'class' | 'interface' | 'struct' | 'record' | 'enum';
  modifiers: string[];
  bases: string[];               // as written, generic arguments left out
  namespace: string;
  usings: string[];              // namespaces imported for this declaration
  aliases: Map<string, string>;
  file: CSharpFile;
  body: { open: number; close: number };
}

const TYPE_KEYWORDS = new Set(['class', 'interface', 'struct', 'record', 'enum']);
const MODIFIERS = new Set(['public', 'internal', 'private', 'protected', 'abstract', 'sealed', 'static', 'partial', 'unsafe', 'new', 'readonly', 'ref', 'file']);

/** A dotted name starting at `i` (`global::` dropped): the name and the index after it. */
export function qualifiedName(tokens: Token[], i: number): { name: string; end: number } | null {
  let j = i;
  if (tokens[j]?.text === 'global' && tokens[j + 1]?.text === '::') j += 2;
  if (tokens[j]?.kind !== 'ident') return null;
  const parts = [tokens[j].text];
  j++;
  while (tokens[j]?.text === '.' && tokens[j + 1]?.kind === 'ident') {
    parts.push(tokens[j + 1].text);
    j += 2;
  }
  return { name: parts.join('.'), end: j };
}

/** Skip a generic argument list `<…>` starting at `i`; returns the index after it. */
function skipGeneric(tokens: Token[], i: number): number {
  if (tokens[i]?.text !== '<') return i;
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    if (tokens[j].text === '<') depth++;
    else if (tokens[j].text === '>' && --depth === 0) return j + 1;
    else if (tokens[j].text === ';' || tokens[j].text === '{') return i;
  }
  return i;
}

/** Every type declaration of a file, with its namespace and the usings in scope. */
export function readDeclarations(file: CSharpFile): TypeDecl[] {
  const { tokens, match } = file;
  const decls: TypeDecl[] = [];

  interface Scope { namespace: string; usings: string[]; aliases: Map<string, string>; types: string[] }
  const walk = (start: number, end: number, scope: Scope) => {
    let ns = scope.namespace;
    const usings = [...scope.usings];
    const aliases = new Map(scope.aliases);
    let i = start;
    while (i < end) {
      const t = tokens[i];
      if (t.kind === 'ident' && t.text === 'using' && scope.types.length === 0 && tokens[i + 1]?.text !== '(') {
        const semi = indexOf(tokens, ';', i, end);
        if (tokens[i + 1]?.text !== 'static') {
          const alias = tokens[i + 2]?.text === '=' ? tokens[i + 1].text : null;
          const q = qualifiedName(tokens, alias ? i + 3 : i + 1);
          if (q && alias) aliases.set(alias, q.name);
          else if (q) usings.push(q.name);
        }
        i = semi + 1;
        continue;
      }
      if (t.kind === 'ident' && t.text === 'namespace' && scope.types.length === 0) {
        const q = qualifiedName(tokens, i + 1);
        if (!q) throw new CSharpSyntaxError('namespace without a name');
        const full = ns ? `${ns}.${q.name}` : q.name;
        if (tokens[q.end]?.text === ';') {             // file-scoped namespace
          ns = full;
          i = q.end + 1;
          continue;
        }
        const close = match.get(q.end);
        if (tokens[q.end]?.text !== '{' || close === undefined) throw new CSharpSyntaxError(`namespace ${full} has no body`);
        walk(q.end + 1, close, { namespace: full, usings, aliases, types: [] });
        i = close + 1;
        continue;
      }
      if (t.kind === 'ident' && TYPE_KEYWORDS.has(t.text) && tokens[i + 1]?.kind === 'ident' && !isMemberContext(tokens, i)) {
        let nameAt = i + 1;
        if (t.text === 'record' && (tokens[i + 1].text === 'class' || tokens[i + 1].text === 'struct')) nameAt = i + 2;
        const name = tokens[nameAt].text;
        const modifiers: string[] = [];
        for (let k = i - 1; k >= start && tokens[k].kind === 'ident' && MODIFIERS.has(tokens[k].text); k--) modifiers.unshift(tokens[k].text);
        let j = skipGeneric(tokens, nameAt + 1);
        if (tokens[j]?.text === '(') j = (match.get(j) ?? j) + 1;   // record primary constructor
        const bases: string[] = [];
        if (tokens[j]?.text === ':') {
          j++;
          for (;;) {
            const q = qualifiedName(tokens, j);
            if (!q) break;
            bases.push(q.name);
            j = skipGeneric(tokens, q.end);
            if (tokens[j]?.text === '(') j = (match.get(j) ?? j) + 1;   // record base arguments
            if (tokens[j]?.text !== ',') break;
            j++;
          }
        }
        while (j < end && tokens[j].text !== '{' && tokens[j].text !== ';') j++;   // where-constraints
        if (tokens[j]?.text === ';') { i = j + 1; continue; }                       // positional record without body
        const close = match.get(j);
        if (close === undefined) throw new CSharpSyntaxError(`type ${name} has no body`);
        const outer = scope.types;
        const fullName = [ns, ...outer, name].filter(Boolean).join('.');
        decls.push({
          name, fullName, kind: (t.text === 'record' ? 'record' : t.text) as TypeDecl['kind'], modifiers, bases,
          namespace: ns, usings, aliases, file, body: { open: j, close },
        });
        if (t.text !== 'enum') walk(j + 1, close, { namespace: ns, usings, aliases, types: [...outer, name] });
        i = close + 1;
        continue;
      }
      i = match.has(i) && scope.types.length > 0 ? match.get(i)! + 1 : i + 1;   // member bodies hold no type declarations we need
    }
  };
  walk(0, tokens.length, { namespace: '', usings: [], aliases: new Map(), types: [] });
  return decls;
}

/** `class` used as a constraint (`where T : class`) or a member type is not a declaration. */
function isMemberContext(tokens: Token[], i: number): boolean {
  const prev = tokens[i - 1]?.text;
  return prev === ':' || prev === ',' || prev === '<' || prev === '(' || prev === '.';
}

function indexOf(tokens: Token[], text: string, from: number, end: number): number {
  for (let k = from; k < end; k++) if (tokens[k].text === text) return k;
  throw new CSharpSyntaxError(`missing '${text}'`);
}

// ── Members ────────────────────────────────────────────────────────────────

export type Member =
  | { kind: 'method'; body: { from: number; to: number }; expression: boolean }
  | { kind: 'property'; expression: { from: number; to: number } | null }
  | { kind: 'field'; value: { from: number; to: number } | null; modifiers: string[] };

/** Names of the methods declared directly in a type. */
export function declaredMethods(decl: TypeDecl): string[] {
  const { tokens, match } = decl.file;
  const names: string[] = [];
  for (let i = decl.body.open + 1; i < decl.body.close; i++) {
    const t = tokens[i];
    if (t.kind === 'ident' && tokens[i + 1]?.text === '(' && isDeclaredName(tokens, i)) names.push(t.text);
    if (match.has(i)) i = match.get(i)!;
  }
  return names;
}

/** The member `name` declared directly in a type (not in nested types), or null. */
export function findMember(decl: TypeDecl, name: string): Member | null {
  const { tokens, match } = decl.file;
  let memberStart = decl.body.open + 1;
  for (let i = decl.body.open + 1; i < decl.body.close; i++) {
    const t = tokens[i];
    if (t.kind === 'ident' && t.text === name && isDeclaredName(tokens, i)) {
      const next = tokens[i + 1]?.text;
      if (next === '(') {
        const closeParams = match.get(i + 1)!;
        const after = tokens[closeParams + 1]?.text;
        if (after === '{') return { kind: 'method', body: { from: closeParams + 2, to: match.get(closeParams + 1)! }, expression: false };
        if (after === '=>') return { kind: 'method', body: { from: closeParams + 2, to: statementEnd(tokens, match, closeParams + 2, decl.body.close) }, expression: true };
        return null;   // abstract or extern
      }
      if (next === '=>') return { kind: 'property', expression: { from: i + 2, to: statementEnd(tokens, match, i + 2, decl.body.close) } };
      if (next === '{') return { kind: 'property', expression: getterExpression(tokens, match, i + 1) };
      if (next === '=' || next === ';') {
        const modifiers = tokens.slice(memberStart, i).filter((x) => x.kind === 'ident').map((x) => x.text);
        return { kind: 'field', value: next === '=' ? { from: i + 2, to: statementEnd(tokens, match, i + 2, decl.body.close) } : null, modifiers };
      }
    }
    if (match.has(i)) {
      i = match.get(i)!;
      if (t.text === '{') memberStart = i + 1;   // the end of a member body (or a nested type)
      continue;
    }
    if (t.text === ';') memberStart = i + 1;
    if (t.text === ']') memberStart = i + 1;
  }
  return null;
}

/** A name in declaration position: after a type (identifier, `>`, `]` or `?`), not after `.`, `=` or `new`. */
function isDeclaredName(tokens: Token[], i: number): boolean {
  const prev = tokens[i - 1];
  if (!prev) return false;
  if (prev.kind === 'ident') return !['new', 'return', 'yield', 'typeof', 'nameof', 'is', 'as', 'await', 'throw', 'case'].includes(prev.text);
  return prev.text === '>' || prev.text === ']' || prev.text === '?';
}

/** Index of the `;` that ends the expression starting at `from` (nested brackets skipped). */
function statementEnd(tokens: Token[], match: Map<number, number>, from: number, limit: number): number {
  for (let k = from; k < limit; k++) {
    if (tokens[k].text === ';') return k;
    if (match.has(k)) k = match.get(k)!;
  }
  throw new CSharpSyntaxError(`missing ';'`);
}

/** `{ get => expr; }` or `{ get { return expr; } }`: the getter's expression; null for other accessor shapes. */
function getterExpression(tokens: Token[], match: Map<number, number>, open: number): { from: number; to: number } | null {
  const close = match.get(open)!;
  for (let k = open + 1; k < close; k++) {
    if (tokens[k].text !== 'get') continue;
    if (tokens[k + 1]?.text === '=>') return { from: k + 2, to: statementEnd(tokens, match, k + 2, close) };
    if (tokens[k + 1]?.text === '{' && tokens[k + 2]?.text === 'return') {
      const to = statementEnd(tokens, match, k + 3, match.get(k + 1)!);
      return to + 1 === match.get(k + 1) ? { from: k + 3, to } : null;   // a single return statement only
    }
  }
  return null;
}

// ── Type names ─────────────────────────────────────────────────────────────

export type Resolution = { fullName: string } | { error: string };

/**
 * Resolve a type name as written in `context` the way C# looks it up: enclosing namespaces from the
 * innermost out, the global namespace, then the usings in scope (two candidates are an ambiguity).
 */
export function resolveTypeName(written: string, context: TypeDecl, index: Map<string, TypeDecl[]>): Resolution {
  const name = written.replace(/^global::/, '');
  const [first, ...rest] = name.split('.');
  const aliased = context.aliases.get(first);
  if (aliased) {
    const full = [aliased, ...rest].join('.');
    return index.has(full) ? { fullName: full } : { error: `${written} is not in the Plugins folder` };
  }

  const nsParts = context.namespace ? context.namespace.split('.') : [];
  for (let k = nsParts.length; k > 0; k--) {
    const candidate = `${nsParts.slice(0, k).join('.')}.${name}`;
    if (index.has(candidate)) return { fullName: candidate };
  }
  if (index.has(name)) return { fullName: name };
  const viaUsings = [...new Set(context.usings.map((u) => `${u}.${name}`).filter((c) => index.has(c)))];
  if (viaUsings.length === 1) return { fullName: viaUsings[0] };
  if (viaUsings.length > 1) return { error: `${written} is ambiguous (${viaUsings.join(', ')})` };
  return { error: `${written} is not in the Plugins folder` };
}
