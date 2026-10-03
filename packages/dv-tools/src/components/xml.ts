import { readFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import { compareStrings } from '../util.js';
import { decodeCharRefs } from '../xml/utils.js';

// XML helpers for the component files of an unpacked solution (plugin steps, plugin assemblies,
// Workflows/*.data.xml, BPF XAML). Values stay strings: numbers are converted where they are read.

/** A solution file's text, without a byte-order mark. */
export function readText(path: string): string {
  return readFileSync(path, 'utf-8').replace(/^﻿/, '');
}

const ARRAYS = new Set(['SdkMessageProcessingStepImage', 'PluginType', 'LocalizedName', 'label']);

export const componentXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name: string) => ARRAYS.has(name),
});

/** A parsed component file; null (with a warning) when it cannot be read. */
export function parseXmlFile(path: string, warn: (message: string) => void): any | null {
  try {
    return componentXmlParser.parse(readText(path));
  } catch (err: any) {
    warn(`could not read ${path}: ${err?.message ?? err}`);
    return null;
  }
}

/** Trimmed text of an element or attribute value (character references decoded, LF only); null when empty. */
export function text(value: unknown): string | null {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)['#text'] : value;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = decodeCharRefs(String(raw)).trim();
  return s ? s : null;
}

export function int(value: unknown): number | null {
  const s = text(value);
  if (s === null || !/^-?\d+$/.test(s)) return null;
  return parseInt(s, 10);
}

const GUID = /^\{?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\}?$/;

/** GUIDs are written lowercase and without braces: `{0F1E…}` → `0f1e…`. */
export function guid(value: unknown): string | null {
  const s = text(value);
  if (s === null) return null;
  const m = GUID.exec(s);
  return m ? m[1].toLowerCase() : s.toLowerCase();
}

export function isGuid(value: string): boolean {
  return GUID.test(value);
}

/** 1/0 or true/false. */
export function flag(value: unknown): boolean {
  const s = text(value)?.toLowerCase();
  return s === '1' || s === 'true';
}

/** A logical name; `none` (no table) gives null. */
export function logicalName(value: unknown): string | null {
  const s = text(value)?.toLowerCase() ?? null;
  return s === 'none' ? null : s;
}

/** Comma-separated logical names → sorted, distinct, lowercase. */
export function nameList(value: unknown): string[] {
  const s = text(value);
  if (!s) return [];
  return [...new Set(s.split(',').map((n) => n.trim().toLowerCase()).filter(Boolean))].sort(compareStrings);
}

/** English (1033) label of a LocalizedNames list. */
export function label1033(items: unknown): string | null {
  if (!Array.isArray(items)) return null;
  return text(items.find((i) => text(i?.['@_languagecode']) === '1033')?.['@_description']);
}

// ── Order-preserving tree (BPF XAML: stages are read in document order) ────

export interface XmlNode {
  name: string;                    // as written, with its namespace prefix
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const treeParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  preserveOrder: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

function toNodes(items: any[]): XmlNode[] {
  const nodes: XmlNode[] = [];
  for (const item of items) {
    const name = Object.keys(item).find((key) => key !== ':@');
    if (!name || name === '#text' || name.startsWith('?')) continue;
    const content: any[] = item[name] ?? [];
    nodes.push({
      name,
      attrs: item[':@'] ?? {},
      children: toNodes(content),
      text: content.filter((c) => '#text' in c).map((c) => String(c['#text'])).join(''),
    });
  }
  return nodes;
}

/** The document's root elements, in order. */
export function parseXmlTree(xml: string): XmlNode[] {
  return toNodes(treeParser.parse(xml));
}

/** Element name without its namespace prefix: `mxswa:ActivityReference` → `ActivityReference`. */
export function localName(node: XmlNode): string {
  return node.name.slice(node.name.indexOf(':') + 1);
}
