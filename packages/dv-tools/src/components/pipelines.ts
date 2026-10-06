import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareStrings, listDir, portableRelative } from '../util.js';
import {
  CSharpSyntaxError, declaredMethods, findMember, matchBrackets, qualifiedName, readDeclarations, resolveTypeName, tokenize,
  type CSharpFile, type Token, type TypeDecl,
} from './csharp.js';

// Pipelines of the DDSol plug-in architecture, read from the C# code in the Plugins folder: each
// entry plug-in (a class deriving from PipelinePluginBase) declares its components in
// Get{Create,Update,Delete,Special}Steps() as PipelineStepDescriptor { Type, ImplementationType,
// Order, Description }. Code that does not follow the architecture gets composition "unknown":
// a whole entry plug-in when the class is not one, else only the message whose method it cannot read.

export type ComponentKind = 'validator' | 'mutator' | 'handler';

export interface PipelineComponentRecord {
  position: number;                     // run position within the message, from 1
  order: number;                        // the descriptor's Order
  type: string;                         // full type name
  kind: ComponentKind;
  declaredFilteringAttributes: string[] | null;   // from the Description ("filtering attributes: …"); null when it does not say
  description: string | null;
  file: string;                         // relative to the Plugins folder
}

export interface PipelineMessageRecord {
  message: 'Create' | 'Update' | 'Delete' | null;   // null: GetSpecialSteps, every other message
  method: string;
  composition: 'known' | 'unknown';
  reason: string | null;                // why this message's composition is unknown
  components: PipelineComponentRecord[];
}

export interface PipelineRecord {
  pluginType: string;
  registered: boolean;                  // a plug-in step of the solution runs it
  entity: string | null;
  stage: number | null;
  stageName: string | null;
  mode: 'sync' | 'async' | null;
  composition: 'known' | 'unknown';     // unknown: not an entry plug-in it can read (no messages)
  reason: string | null;
  messages: PipelineMessageRecord[];
  file: string | null;                  // relative to the Plugins folder
}

/** A Custom API's implementing plug-in type, which is not registered on a step. */
export interface CustomApiImplementation {
  pluginType: string;
  uniqueName: string;
}

const STEP_METHODS: Array<{ method: string; message: PipelineMessageRecord['message'] }> = [
  { method: 'GetCreateSteps', message: 'Create' },
  { method: 'GetUpdateSteps', message: 'Update' },
  { method: 'GetDeleteSteps', message: 'Delete' },
  { method: 'GetSpecialSteps', message: null },
];

/**
 * Entry plug-in names (§7): the stage, and the mode unless ExecutionMode says otherwise. PreValidation
 * steps are always synchronous; a plain `…PostOperationPlugin` leaves the mode to ExecutionMode.
 */
const ENTRY_SUFFIXES: Array<{ suffix: string; stage: number; stageName: string; mode: 'sync' | 'async' | null }> = [
  { suffix: 'PreValidationPlugin', stage: 10, stageName: 'preValidation', mode: 'sync' },
  { suffix: 'PreOperationPlugin', stage: 20, stageName: 'preOperation', mode: 'sync' },
  { suffix: 'PostOperationSyncPlugin', stage: 40, stageName: 'postOperation', mode: 'sync' },
  { suffix: 'PostOperationAsyncPlugin', stage: 40, stageName: 'postOperation', mode: 'async' },
  { suffix: 'PostOperationPlugin', stage: 40, stageName: 'postOperation', mode: null },
];

const KINDS: Record<string, ComponentKind> = { Validator: 'validator', Mutator: 'mutator', Handler: 'handler' };
const INTERFACES: Record<string, ComponentKind> = { IEntityValidator: 'validator', IEntityMutator: 'mutator', IEntityHandler: 'handler' };

const lastSegment = (name: string) => name.slice(name.lastIndexOf('.') + 1);

class Unknown extends Error {}

// ── Reading the folder ─────────────────────────────────────────────────────

/** *.cs files under the Plugins folder in name order, without build output (bin, obj) and hidden folders. */
function sourceFiles(dir: string): string[] {
  const files = listDir(dir, 'files').filter((f) => f.toLowerCase().endsWith('.cs')).map((f) => join(dir, f));
  for (const sub of listDir(dir, 'dirs')) {
    if (sub.startsWith('.') || ['bin', 'obj'].includes(sub.toLowerCase())) continue;
    files.push(...sourceFiles(join(dir, sub)));
  }
  return files;
}

interface CodeIndex {
  types: Map<string, TypeDecl[]>;                       // full name → declarations (partial parts)
  unreadable: Map<string, { file: string; error: string }>;   // class name → a file that could not be read
}

function indexFolder(pluginsPath: string, warn: (message: string) => void): CodeIndex {
  const types = new Map<string, TypeDecl[]>();
  const unreadable = new Map<string, { file: string; error: string }>();
  for (const path of sourceFiles(pluginsPath)) {
    const src = readFileSync(path, 'utf-8').replace(/^﻿/, '');
    try {
      const tokens = tokenize(src);
      const file: CSharpFile = { path, tokens, match: matchBrackets(tokens) };
      for (const decl of readDeclarations(file)) types.set(decl.fullName, [...(types.get(decl.fullName) ?? []), decl]);
    } catch (err) {
      if (!(err instanceof CSharpSyntaxError)) throw err;
      warn(`could not read ${path}: ${err.message}`);
      for (const m of src.matchAll(/\bclass\s+([A-Za-z_]\w*)/g)) unreadable.set(m[1], { file: path, error: err.message });
    }
  }
  return { types, unreadable };
}

// ── Descriptors ────────────────────────────────────────────────────────────

interface Descriptor {
  kind: ComponentKind;
  implementationType: string;   // as written
  order: number;
  description: string | null;
}

/** Top-level ranges of [from, to) split at `sep` (brackets skipped). */
function split(tokens: Token[], match: Map<number, number>, from: number, to: number, sep: string): Array<[number, number]> {
  const parts: Array<[number, number]> = [];
  let start = from;
  for (let k = from; k < to; k++) {
    if (tokens[k].text === sep) { parts.push([start, k]); start = k + 1; continue; }
    if (match.has(k)) k = match.get(k)!;
  }
  if (start < to) parts.push([start, to]);
  return parts;
}

const text = (tokens: Token[], from: number, to: number) => tokens.slice(from, to).map((t) => t.text).join(' ');

/** `new [Ns.]PipelineStepDescriptor [()] { Type = …, ImplementationType = typeof(…), Order = …, Description = … }` */
function readDescriptor(file: CSharpFile, from: number, to: number, where: string): Descriptor {
  const { tokens, match } = file;
  const type = tokens[from]?.text === 'new' ? qualifiedName(tokens, from + 1) : null;
  if (!type || lastSegment(type.name) !== 'PipelineStepDescriptor') throw new Unknown(`${where} returns something other than a new PipelineStepDescriptor`);
  let open = type.end;
  if (tokens[open]?.text === '(' && tokens[open + 1]?.text === ')') open += 2;
  if (tokens[open]?.text !== '{' || match.get(open) !== to - 1) throw new Unknown(`${where}: a PipelineStepDescriptor is not set with an object initializer`);

  const fields = new Map<string, [number, number]>();
  for (const [a, b] of split(tokens, match, open + 1, to - 1, ',')) {
    if (tokens[a]?.kind !== 'ident' || tokens[a + 1]?.text !== '=') throw new Unknown(`${where}: a PipelineStepDescriptor initializer holds something other than property assignments`);
    fields.set(tokens[a].text, [a + 2, b]);
  }

  const kindRange = fields.get('Type');
  const kindName = kindRange ? qualifiedName(tokens, kindRange[0]) : null;
  const kindParts = kindName?.name.split('.') ?? [];
  const kind = kindName && kindName.end === kindRange![1] && kindParts.at(-2) === 'PipelineComponentType' ? KINDS[kindParts.at(-1)!] : undefined;
  if (!kind) throw new Unknown(`${where}: Type is not PipelineComponentType.Validator, .Mutator or .Handler`);

  const implRange = fields.get('ImplementationType');
  const impl = implRange && tokens[implRange[0]]?.text === 'typeof' && tokens[implRange[0] + 1]?.text === '(' ? qualifiedName(tokens, implRange[0] + 2) : null;
  if (!impl || tokens[impl.end]?.text !== ')' || impl.end + 1 !== implRange![1]) throw new Unknown(`${where}: ImplementationType is not typeof(<class>)`);

  const orderRange = fields.get('Order');
  let order = 0;   // C#'s default when Order is not set
  if (orderRange) {
    const [a, b] = orderRange;
    const negative = tokens[a]?.text === '-';
    const digits = tokens[negative ? a + 1 : a];
    if (digits?.kind !== 'number' || (negative ? a + 2 : a + 1) !== b || !/^[0-9_]+$/.test(digits.text)) {
      throw new Unknown(`${where}: Order of ${impl.name} is not a number`);
    }
    order = (negative ? -1 : 1) * parseInt(digits.text.replace(/_/g, ''), 10);
  }

  return { kind, implementationType: impl.name, order, description: stringValue(tokens, fields.get('Description')) };
}

/** A string literal or a `+` concatenation of them; null for anything else. */
function stringValue(tokens: Token[], range: [number, number] | undefined): string | null {
  if (!range) return null;
  let value = '';
  for (let k = range[0]; k < range[1]; k++) {
    const t = tokens[k];
    if ((k - range[0]) % 2 === 1) { if (t.text !== '+') return null; continue; }
    if (t.kind !== 'string' || t.value == null) return null;
    value += t.value;
  }
  return value.replace(/\r\n?/g, '\n');
}

/** `Enumerable.Empty<…>()`, `Array.Empty<…>()`, `new …[0]`, `new List<…>()`: no steps. */
function isEmptyCollection(tokens: Token[], from: number, to: number): boolean {
  const code = text(tokens, from, to).replace(/\s+/g, '');
  return /^(?:[\w.]*\.)?(?:Enumerable|Array)\.Empty<[\w.]*PipelineStepDescriptor>\(\)$/.test(code)
    || /^new[\w.]*PipelineStepDescriptor\[0\]$/.test(code)
    || /^new[\w.]*(?:List|Collection)<[\w.]*PipelineStepDescriptor>\(\)$/.test(code);
}

/** `new[] { d, … }`, `new PipelineStepDescriptor[] { … }` or `new List<PipelineStepDescriptor> { … }`, or an empty collection. */
function readCollection(file: CSharpFile, from: number, to: number, where: string): Descriptor[] {
  const { tokens, match } = file;
  if (isEmptyCollection(tokens, from, to)) return [];
  const open = tokens.findIndex((t, k) => k >= from && k < to && t.text === '{');
  const head = open > 0 ? text(tokens, from, open).replace(/\s+/g, '') : '';
  const collection = /^new(?:[\w.]*PipelineStepDescriptor)?\[\]$/.test(head) || /^new[\w.]*(?:List|Collection)<[\w.]*PipelineStepDescriptor>(?:\(\))?$/.test(head);
  if (!collection || match.get(open) !== to - 1) throw new Unknown(`${where} does not return a list of PipelineStepDescriptor`);
  return split(tokens, match, open + 1, to - 1, ',').map(([a, b]) => readDescriptor(file, a, b, where));
}

/** The descriptors a step method returns: `yield return new PipelineStepDescriptor { … };` statements, or one returned collection. */
function readStepMethod(decl: TypeDecl, method: string): Descriptor[] {
  const member = findMember(decl, method);
  if (!member) return [];
  const where = `${decl.name}.${method}`;
  if (member.kind !== 'method') throw new Unknown(`${where} is not a method`);
  const { tokens, match } = decl.file;
  const { from, to } = member.body;
  if (member.expression) return readCollection(decl.file, from, to, where);

  const descriptors: Descriptor[] = [];
  const statements = split(tokens, match, from, to, ';');
  for (const [index, [a, b]] of statements.entries()) {
    if (a === b) continue;   // an empty statement
    const first = tokens[a]?.text;
    const second = tokens[a + 1]?.text;
    if (first === 'yield' && second === 'break' && b === a + 2) break;
    if (first === 'yield' && second === 'return') { descriptors.push(readDescriptor(decl.file, a + 2, b, where)); continue; }
    if (first === 'return' && statements.length === 1 && index === 0) return readCollection(decl.file, a + 1, b, where);
    throw new Unknown(`${where} is not a list of "yield return new PipelineStepDescriptor { … }" statements (it has a "${first}" statement)`);
  }
  return descriptors;
}

// ── Components ─────────────────────────────────────────────────────────────

/** The interfaces of the pipeline a class implements, also through base classes in the folder. */
function implementedKinds(decl: TypeDecl, index: CodeIndex, depth = 0): Set<ComponentKind> {
  const kinds = new Set<ComponentKind>();
  if (depth > 8) return kinds;
  for (const base of decl.bases) {
    const kind = INTERFACES[lastSegment(base)];
    if (kind) { kinds.add(kind); continue; }
    const resolved = resolveTypeName(base, decl, index.types);
    if ('fullName' in resolved) {
      for (const part of index.types.get(resolved.fullName)!) for (const k of implementedKinds(part, index, depth + 1)) kinds.add(k);
    }
  }
  return kinds;
}

/** "filtering attributes: a,b" in a description: [] for "none", null when it does not say or is not a column list. */
export function filteringAttributesOf(description: string | null): string[] | null {
  const m = description ? /filtering attributes?\s*:\s*([^;\n]*)/i.exec(description) : null;
  if (!m) return null;
  const value = m[1].trim().replace(/\.$/, '').trim();
  if (/^none\b/i.test(value)) return [];
  const names = value.split(',').map((s) => s.trim());
  if (!names.length || names.some((s) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s))) return null;
  return [...new Set(names.map((s) => s.toLowerCase()))].sort(compareStrings);
}

// ── Entry plug-ins ─────────────────────────────────────────────────────────

/** `"dvt_project"` or `<EarlyBoundClass>.EntityLogicalName` with a constant in the folder; null otherwise. */
function entityOf(decl: TypeDecl, index: CodeIndex): string | null {
  const member = findMember(decl, 'EntityLogicalName');
  if (member?.kind !== 'property' || !member.expression) return null;
  const { tokens } = decl.file;
  const { from, to } = member.expression;
  if (to === from + 1 && tokens[from].kind === 'string') return tokens[from].value?.toLowerCase() ?? null;
  const ref = qualifiedName(tokens, from);
  if (!ref || ref.end !== to || !ref.name.endsWith('.EntityLogicalName')) return null;
  const resolved = resolveTypeName(ref.name.slice(0, -'.EntityLogicalName'.length), decl, index.types);
  if (!('fullName' in resolved)) return null;
  for (const part of index.types.get(resolved.fullName)!) {
    const constant = findMember(part, 'EntityLogicalName');
    if (constant?.kind === 'field' && constant.value && constant.value.to === constant.value.from + 1) {
      const literal = part.file.tokens[constant.value.from];
      if (literal.kind === 'string' && literal.value) return literal.value.toLowerCase();
    }
  }
  return null;
}

/** ExecutionMode => PipelineExecutionMode.Async / .Sync, when declared. */
function declaredMode(decl: TypeDecl): 'sync' | 'async' | null {
  const member = findMember(decl, 'ExecutionMode');
  if (member?.kind !== 'property' || !member.expression) return null;
  const ref = qualifiedName(decl.file.tokens, member.expression.from);
  const value = ref && ref.end === member.expression.to ? lastSegment(ref.name) : null;
  return value === 'Async' ? 'async' : value === 'Sync' ? 'sync' : null;
}

/** One step method's components in run order; Unknown when the method or a component cannot be read. */
function messageOf(decl: TypeDecl, method: string, index: CodeIndex, pluginsPath: string): PipelineComponentRecord[] | null {
  const descriptors = readStepMethod(decl, method);
  if (!descriptors.length) return null;
  const components = descriptors.map((d): Omit<PipelineComponentRecord, 'position'> => {
    const resolved = resolveTypeName(d.implementationType, decl, index.types);
    if (!('fullName' in resolved)) throw new Unknown(`${decl.name}.${method}: ${resolved.error}`);
    const component = index.types.get(resolved.fullName)![0];
    const implemented = implementedKinds(component, index);
    if (implemented.size && !implemented.has(d.kind)) {
      throw new Unknown(`${component.name} is declared as a ${d.kind} but implements ${[...implemented].map((k) => Object.keys(INTERFACES).find((i) => INTERFACES[i] === k)).join(', ')}`);
    }
    return {
      order: d.order,
      type: resolved.fullName,
      kind: d.kind,
      declaredFilteringAttributes: filteringAttributesOf(d.description),
      description: d.description,
      file: portableRelative(pluginsPath, component.file.path),
    };
  });
  // the engine runs steps by Order, then by full type name
  components.sort((a, b) => a.order - b.order || compareStrings(a.type, b.type));
  return components.map((c, i) => ({ position: i + 1, ...c }));
}

const isUnknown = (err: unknown): err is Error => err instanceof Unknown || err instanceof CSharpSyntaxError;

function pipelineOf(fullName: string, parts: TypeDecl[], index: CodeIndex, pluginsPath: string, registered: boolean): PipelineRecord {
  const decl = parts[0];
  const suffix = ENTRY_SUFFIXES.find((s) => decl.name.endsWith(s.suffix));
  const record: PipelineRecord = {
    pluginType: fullName,
    registered,
    entity: null,
    stage: suffix?.stage ?? null,
    stageName: suffix?.stageName ?? null,
    mode: suffix?.mode ?? null,
    composition: 'known',
    reason: null,
    messages: [],
    file: portableRelative(pluginsPath, decl.file.path),
  };

  try {
    record.entity = entityOf(decl, index);
    record.mode = declaredMode(decl) ?? record.mode;
    if (parts.length > 1) throw new Unknown(`${decl.name} is declared in several files`);
    const methods = declaredMethods(decl);
    // the legacy engine: steps in a separate registration object, or stage-specific step methods
    if (methods.includes('GetRegistration')) throw new Unknown(`${decl.name} declares GetRegistration(): the legacy engine's separate registration`);
    const legacy = methods.filter((m) => /^Get\w*Steps$/.test(m) && !STEP_METHODS.some((s) => s.method === m));
    if (legacy.length) throw new Unknown(`${decl.name} declares ${legacy.join(', ')}: stage-specific step methods of the legacy engine`);
  } catch (err) {
    if (!isUnknown(err)) throw err;
    return { ...record, composition: 'unknown', reason: err.message };
  }

  // a message whose method cannot be read is unknown; the others keep their components
  for (const { method, message } of STEP_METHODS) {
    try {
      const components = messageOf(decl, method, index, pluginsPath);
      if (components) record.messages.push({ message, method, composition: 'known', reason: null, components });
    } catch (err) {
      if (!isUnknown(err)) throw err;
      record.messages.push({ message, method, composition: 'unknown', reason: err.message, components: [] });
    }
  }
  return record;
}

const unknown = (pluginType: string, registered: boolean, reason: string, file: string | null): PipelineRecord => ({
  pluginType, registered, entity: null, stage: null, stageName: null, mode: null, composition: 'unknown', reason, messages: [], file,
});

/** The base class chain of a class within the folder, nearest first (unresolvable bases end it). */
function baseChain(decl: TypeDecl, index: CodeIndex): TypeDecl[] {
  const chain: TypeDecl[] = [];
  for (let current = decl; chain.length < 16;) {
    const base = current.bases[0];
    if (!base) break;
    const resolved = resolveTypeName(base, current, index.types);
    if (!('fullName' in resolved)) break;
    current = index.types.get(resolved.fullName)![0];
    if (chain.includes(current)) break;
    chain.push(current);
  }
  return chain;
}

/**
 * The pipelines of the Plugins folder: every class deriving from PipelinePluginBase, every plug-in
 * type registered on a step and every Custom API implementation. What does not follow the
 * architecture gets composition "unknown" with the reason. Paths are relative to the folder.
 */
export function readPipelines(
  pluginsPath: string,
  registeredTypes: string[],
  customApis: CustomApiImplementation[],
  warn: (message: string) => void,
): PipelineRecord[] {
  const index = indexFolder(pluginsPath, warn);
  const registered = new Set(registeredTypes);
  const entries = new Map<string, PipelineRecord>();
  const relative = (path: string) => portableRelative(pluginsPath, path);

  for (const [fullName, parts] of index.types) {
    const decl = parts[0];
    if (decl.kind !== 'class' || decl.modifiers.includes('abstract')) continue;
    if (lastSegment(decl.bases[0] ?? '') === 'PipelinePluginBase') {
      entries.set(fullName, pipelineOf(fullName, parts, index, pluginsPath, registered.has(fullName)));
      continue;
    }
    // an entry plug-in behind an intermediate base class: reported, not read
    const chain = baseChain(decl, index);
    const through = chain.findIndex((c) => lastSegment(c.bases[0] ?? '') === 'PipelinePluginBase');
    if (through >= 0) {
      entries.set(fullName, unknown(fullName, registered.has(fullName),
        `${decl.name} derives from PipelinePluginBase through ${chain.slice(0, through + 1).map((c) => c.name).join(', ')}, not directly`,
        relative(decl.file.path)));
    }
  }

  const notAnEntry = (fullName: string, context: string) => {
    const parts = index.types.get(fullName);
    if (!parts) {
      const unreadable = index.unreadable.get(lastSegment(fullName));
      return unreadable
        ? unknown(fullName, registered.has(fullName), `${context}${unreadable.error} in ${relative(unreadable.file)}`, relative(unreadable.file))
        : unknown(fullName, registered.has(fullName), `${context}not found in the Plugins folder`, null);
    }
    const bases = parts[0].bases.length ? parts[0].bases.join(', ') : 'nothing';
    return unknown(fullName, registered.has(fullName), `${context}${parts[0].name} derives from ${bases}, not PipelinePluginBase`, relative(parts[0].file.path));
  };
  for (const fullName of registeredTypes) {
    if (!entries.has(fullName)) entries.set(fullName, notAnEntry(fullName, ''));
  }
  for (const api of customApis) {
    if (!entries.has(api.pluginType)) entries.set(api.pluginType, notAnEntry(api.pluginType, `implements the Custom API ${api.uniqueName}; `));
  }

  return [...entries.values()].sort((a, b) => compareStrings(a.pluginType, b.pluginType));
}
