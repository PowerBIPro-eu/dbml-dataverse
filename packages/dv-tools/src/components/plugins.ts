import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { compareStrings, listDir, portableRelative } from '../util.js';
import { guid, int, logicalName, nameList, parseXmlFile, text } from './xml.js';
import { parseStepName, sdkMessageName } from './sdkMessages.js';

// Plugin assemblies (PluginAssemblies/<folder>/<name>.dll.data.xml) and plugin steps
// (SdkMessageProcessingSteps/<id>.xml) of one unpacked solution folder.

export interface PluginAssemblyRecord {
  id: string | null;
  name: string;
  version: string | null;
  file: string;                    // relative to the layer folder
}

export interface PluginTypeRecord {
  id: string | null;
  name: string;                    // full type name, e.g. Dvt.Plugins.Project.ValidateBudget
  assembly: string;
  kind: 'plugin' | 'workflowActivity';
  file: string;
}

export interface StepImageRecord {
  name: string | null;
  alias: string | null;            // EntityAlias: the key the plugin code reads the image with
  type: 'pre' | 'post' | 'both' | null;
  attributes: string[];            // empty: all columns
}

export type HandlerKind = 'plugin' | 'webhook' | 'serviceEndpoint';

export interface PluginStepRecord {
  id: string | null;
  name: string | null;
  handlerKind: HandlerKind | null;  // a service endpoint becomes 'webhook' (contract 8) when merging
  pluginType: string | null;
  pluginTypeId: string | null;
  assembly: string | null;
  serviceEndpoint: { id: string | null; name: string | null } | null;   // webhook and service endpoint steps
  message: string | null;
  messageId: string | null;
  primaryEntity: string | null;    // null: no table (registered on a message without one)
  stage: number | null;
  stageName: string | null;
  mode: 'sync' | 'async' | null;
  rank: number | null;
  filteringAttributes: string[];   // empty: not filtered
  images: StepImageRecord[];
  file: string;
}

/** PluginAssemblies/ServiceEndpoints.xml: webhooks, Azure Service Bus, Event Hub, Event Grid, … */
export interface ServiceEndpointRecord {
  id: string | null;
  name: string | null;
  contract: number | null;         // 8: webhook
}

export interface PluginFiles {
  assemblies: PluginAssemblyRecord[];
  types: PluginTypeRecord[];
  steps: PluginStepRecord[];
  serviceEndpoints: ServiceEndpointRecord[];
}

export const STAGES: Record<number, string> = { 10: 'preValidation', 20: 'preOperation', 30: 'mainOperation', 40: 'postOperation' };

/** EventHandlerTypeCode: the object type the step's handler is. */
const PLUGIN_TYPE_CODE = 4602;
const SERVICE_ENDPOINT_TYPE_CODE = 4618;
export const WEBHOOK_CONTRACT = 8;
const MODES: Record<number, 'sync' | 'async'> = { 0: 'sync', 1: 'async' };
const IMAGE_TYPES: Record<number, 'pre' | 'post' | 'both'> = { 0: 'pre', 1: 'post', 2: 'both' };

/** `Name, Version=1.0.0.0, Culture=neutral, PublicKeyToken=…` → its parts (an assembly-qualified type name has the type first). */
function nameParts(qualified: string | null): { parts: string[]; version: string | null } {
  const parts = (qualified ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  const version = parts.find((p) => p.startsWith('Version='))?.slice('Version='.length) ?? null;
  return { parts: parts.filter((p) => !p.includes('=')), version };
}

/** `*.data.xml` in PluginAssemblies and its subfolders, in name order. */
function assemblyDataFiles(dir: string): string[] {
  const files = listDir(dir, 'files').map((f) => join(dir, f));
  for (const sub of listDir(dir, 'dirs')) {
    files.push(...listDir(join(dir, sub), 'files').map((f) => join(dir, sub, f)));
  }
  return files.filter((f) => f.toLowerCase().endsWith('.data.xml'));
}

function readAssemblies(root: string, layerPath: string, warn: (message: string) => void) {
  const assemblies: PluginAssemblyRecord[] = [];
  const types: PluginTypeRecord[] = [];
  const dir = join(root, 'PluginAssemblies');
  if (!existsSync(dir)) return { assemblies, types };

  for (const path of assemblyDataFiles(dir)) {
    const el = parseXmlFile(path, warn)?.PluginAssembly;
    if (!el) continue;
    const { parts, version } = nameParts(text(el['@_FullName']));
    if (!parts[0]) {
      warn(`${path}: PluginAssembly has no FullName; skipped`);
      continue;
    }
    const file = portableRelative(layerPath, path);
    assemblies.push({ id: guid(el['@_PluginAssemblyId']), name: parts[0], version, file });
    for (const type of el.PluginTypes?.PluginType ?? []) {
      // Name may be a friendly name (custom workflow activities, custom APIs): the full type name is in the qualified name
      const name = nameParts(text(type['@_AssemblyQualifiedName'])).parts[0] ?? text(type['@_Name']);
      if (!name) continue;
      types.push({
        id: guid(type['@_PluginTypeId']),
        name,
        assembly: parts[0],
        kind: text(type.WorkflowActivityGroupName) ? 'workflowActivity' : 'plugin',
        file,
      });
    }
  }
  return { assemblies, types };
}

function readImages(step: any): StepImageRecord[] {
  return (step.SdkMessageProcessingStepImages?.SdkMessageProcessingStepImage ?? [])
    .map((image: any): StepImageRecord => ({
      name: text(image['@_Name']),
      alias: text(image.EntityAlias),
      type: IMAGE_TYPES[int(image.ImageType) ?? -1] ?? null,
      attributes: nameList(image.Attributes),
    }))
    .sort((a: StepImageRecord, b: StepImageRecord) =>
      compareStrings(a.name ?? '', b.name ?? '') || compareStrings(a.alias ?? '', b.alias ?? ''));
}

/** 4602: a plugin type; 4618: a service endpoint, by `<EventHandler>` id. Old exports without the code name a plugin type. */
function handlerOf(step: any): Pick<PluginStepRecord, 'handlerKind' | 'serviceEndpoint'> {
  const code = int(step.EventHandlerTypeCode);
  if (code === SERVICE_ENDPOINT_TYPE_CODE) return { handlerKind: 'serviceEndpoint', serviceEndpoint: { id: guid(step.EventHandler), name: null } };
  const namesPluginType = 'PluginTypeName' in step || 'PluginTypeId' in step || 'PluginTypeExportKey' in step;
  return { handlerKind: code === PLUGIN_TYPE_CODE || (code === null && namesPluginType) ? 'plugin' : null, serviceEndpoint: null };
}

function readStep(path: string, layerPath: string, warn: (message: string) => void): PluginStepRecord | null {
  const step = parseXmlFile(path, warn)?.SdkMessageProcessingStep;
  if (!step) return null;
  const name = text(step['@_Name']);
  const fromName = parseStepName(name);
  const messageId = guid(step.SdkMessageId);
  const handler = handlerOf(step);
  const plugin = handler.handlerKind === 'plugin';
  // a step of a plugin package has a PluginTypeExportKey instead of PluginTypeName and PluginTypeId
  const { parts } = nameParts(plugin ? text(step.PluginTypeName) : null);
  const stage = int(step.Stage);
  return {
    id: guid(step['@_SdkMessageProcessingStepId']),
    name,
    handlerKind: handler.handlerKind,
    pluginType: parts[0] ?? null,     // completed from the type id or the step name when merging
    pluginTypeId: plugin ? guid(step.PluginTypeId) : null,
    assembly: parts[1] ?? null,
    serviceEndpoint: handler.serviceEndpoint,
    message: sdkMessageName(messageId) ?? fromName?.message ?? null,
    messageId,
    primaryEntity: logicalName(step.PrimaryEntity),   // left out for a message without a table
    stage,
    stageName: STAGES[stage ?? -1] ?? null,
    mode: MODES[int(step.Mode) ?? -1] ?? null,
    rank: int(step.Rank),
    filteringAttributes: nameList(step.FilteringAttributes),
    images: readImages(step),
    file: portableRelative(layerPath, path),
  };
}

/** PluginAssemblies/ServiceEndpoints.xml, which holds every service endpoint of the solution. */
function readServiceEndpoints(root: string, warn: (message: string) => void): ServiceEndpointRecord[] {
  const path = join(root, 'PluginAssemblies', 'ServiceEndpoints.xml');
  if (!existsSync(path)) return [];
  return (parseXmlFile(path, warn)?.ServiceEndpoints?.ServiceEndpoint ?? []).map((endpoint: any): ServiceEndpointRecord => ({
    id: guid(endpoint['@_ServiceEndpointId']),
    name: text(endpoint['@_Name']),
    contract: int(endpoint.Contract),
  }));
}

/** Plugin assemblies, their types, service endpoints and the plugin steps of one solution folder. */
export function readPlugins(root: string, layerPath: string, warn: (message: string) => void): PluginFiles {
  const { assemblies, types } = readAssemblies(root, layerPath, warn);
  const steps: PluginStepRecord[] = [];
  const dir = join(root, 'SdkMessageProcessingSteps');
  if (existsSync(dir)) {
    for (const fn of listDir(dir, 'files')) {
      if (!fn.toLowerCase().endsWith('.xml')) continue;
      const step = readStep(join(dir, fn), layerPath, warn);
      if (step) steps.push(step);
    }
  }
  return { assemblies, types, steps, serviceEndpoints: readServiceEndpoints(root, warn) };
}
