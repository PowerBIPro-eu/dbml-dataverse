import { compareStrings } from '../util.js';
import type { Provenance } from '../model/finalize.js';
import { readCustomApis, type CustomApiRecord } from './customApis.js';
import { readPlugins, type PluginAssemblyRecord, type PluginStepRecord, type PluginTypeRecord } from './plugins.js';
import { parseStepName } from './sdkMessages.js';
import {
  readWorkflows, type BusinessProcessFlowRecord, type ClassicWorkflowRecord, type CloudFlowRecord,
} from './workflows.js';

// components.json: the solution's components outside the data model — plugin assemblies, types and
// steps, custom APIs, cloud flows, business process flows and classic workflows — written next to
// model.json.

export const COMPONENTS_SCHEMA = 1;
export const COMPONENTS_FILE = 'components.json';

export interface LayerComponents {
  pluginAssemblies: PluginAssemblyRecord[];
  pluginTypes: PluginTypeRecord[];
  pluginSteps: PluginStepRecord[];
  customApis: CustomApiRecord[];
  cloudFlows: CloudFlowRecord[];
  businessProcessFlows: BusinessProcessFlowRecord[];
  classicWorkflows: ClassicWorkflowRecord[];
}

type FromLayer<T> = T & { sourceSolution: string };

export interface Components {
  componentsSchema: typeof COMPONENTS_SCHEMA;
  provenance: Provenance;
  pluginAssemblies: FromLayer<PluginAssemblyRecord>[];
  pluginTypes: FromLayer<PluginTypeRecord>[];
  pluginSteps: FromLayer<PluginStepRecord>[];
  customApis: FromLayer<CustomApiRecord>[];
  cloudFlows: FromLayer<CloudFlowRecord>[];
  businessProcessFlows: FromLayer<BusinessProcessFlowRecord>[];
  classicWorkflows: FromLayer<ClassicWorkflowRecord>[];
}

/**
 * Read the components of one solution folder.
 * @param root      the folder that holds Workflows/, PluginAssemblies/, … (the solution folder or its src/)
 * @param layerPath the solution folder; `file` values are relative to it
 */
export function readLayerComponents(
  layerName: string,
  root: string,
  layerPath: string,
  entityOf: (entitySetName: string) => string | null,
): LayerComponents {
  const warn = (message: string) => console.error(`[${layerName}] Warning: ${message}`);
  const plugins = readPlugins(root, layerPath, warn);
  const components: LayerComponents = {
    pluginAssemblies: plugins.assemblies,
    pluginTypes: plugins.types,
    pluginSteps: plugins.steps,
    customApis: readCustomApis(root, layerPath, warn),
    ...readWorkflows(root, layerPath, entityOf, warn),
  };
  console.error(`[${layerName}] Read ${components.pluginSteps.length} plugin steps, ${components.customApis.length} custom APIs, `
    + `${components.cloudFlows.length} cloud flows, ${components.businessProcessFlows.length} business process flows, `
    + `${components.classicWorkflows.length} classic workflows`);
  return components;
}

type Named = { name: string | null; id: string | null };

const byNameThenId = (a: Named, b: Named) => compareStrings(a.name ?? '', b.name ?? '') || compareStrings(a.id ?? '', b.id ?? '');
const byIdOrName = (item: Named) => item.id ?? `name:${item.name ?? ''}`;

/** A component in several layers is taken from the first one, as columns are. */
function firstWins<T>(layers: Array<{ name: string; items: T[] }>, key: (item: T) => string): FromLayer<T>[] {
  const byKey = new Map<string, FromLayer<T>>();
  for (const layer of layers) {
    for (const item of layer.items) {
      if (!byKey.has(key(item))) byKey.set(key(item), { ...item, sourceSolution: layer.name });
    }
  }
  return [...byKey.values()];
}

/** Merge the layers (base layer first) into components.json. */
export function buildComponents(layers: Array<{ name: string; components: LayerComponents }>, provenance: Provenance): Components {
  const fromLayers = <K extends keyof LayerComponents>(key: K) =>
    layers.map((l) => ({ name: l.name, items: l.components[key] as LayerComponents[K][number][] }));
  // every list by name, then id
  const merge = <K extends Exclude<keyof LayerComponents, 'customApis'>>(key: K) =>
    firstWins(fromLayers(key), byIdOrName).sort(byNameThenId);

  const pluginTypes = merge('pluginTypes');
  // a step or custom API names its plugin type by assembly-qualified name, else by type id (the type
  // may be in another layer); a step of a plugin package only in its name
  const typeById = new Map(pluginTypes.filter((t) => t.id).map((t) => [t.id!, t]));
  const typeOf = (id: string | null) => (id ? typeById.get(id) : undefined);

  const pluginSteps = merge('pluginSteps').map((step) => ({
    ...step,
    pluginType: step.pluginType ?? typeOf(step.pluginTypeId)?.name ?? parseStepName(step.name)?.pluginType ?? null,
    assembly: step.assembly ?? typeOf(step.pluginTypeId)?.assembly ?? null,
  }));

  // custom APIs by unique name (case-insensitive in Dataverse)
  const customApis = firstWins(fromLayers('customApis'), (api) => api.uniqueName.toLowerCase())
    .sort((a, b) => compareStrings(a.uniqueName, b.uniqueName))
    .map((api) => ({
      ...api,
      pluginType: typeOf(api.pluginTypeId)?.name ?? null,
      assembly: typeOf(api.pluginTypeId)?.assembly ?? null,
    }));

  return {
    componentsSchema: COMPONENTS_SCHEMA,
    provenance,
    pluginAssemblies: merge('pluginAssemblies'),
    pluginTypes,
    pluginSteps,
    customApis,
    cloudFlows: merge('cloudFlows'),
    businessProcessFlows: merge('businessProcessFlows'),
    classicWorkflows: merge('classicWorkflows'),
  };
}

/** components.json text: 2-space JSON, LF, trailing newline (as model.json). */
export function serializeComponents(components: Components): string {
  return JSON.stringify(components, null, 2) + '\n';
}
