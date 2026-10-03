import { compareStrings } from '../util.js';
import { int, logicalName, nameList } from './xml.js';

// Facts from a cloud flow definition (Workflows/<name>-<id>.json): its trigger, connection
// references and the Dataverse actions it runs. Pure: no I/O.

export const DATAVERSE_CONNECTOR = 'shared_commondataserviceforapps';

export type TriggerKind =
  | 'dataverse' | 'connector' | 'manual' | 'powerApps' | 'copilot' | 'powerPages' | 'http' | 'recurrence' | 'other';

export interface FlowTriggerRecord {
  name: string;
  kind: TriggerKind;
  connector: string | null;
  operation: string | null;
  entity: string | null;
  messages: string[];              // Dataverse triggers: the SDK messages they run on
  scope: string | null;
  filteringAttributes: string[];   // empty: not filtered
  filterExpression: string | null;
}

export interface ConnectionReferenceRecord {
  name: string;                    // the key the flow's actions use
  logicalName: string | null;      // the connection reference (solution component)
  connector: string | null;
}

export interface DataverseActionRecord {
  name: string;
  operation: string | null;
  entity: string | null;           // logical name, when the entity set is a table of the solution
  entitySetName: string | null;    // as written in the flow; null when it is an expression
  actionName: string | null;       // bound and unbound actions (custom APIs, actions)
}

export interface FlowDefinitionFacts {
  trigger: FlowTriggerRecord | null;
  connectionReferences: ConnectionReferenceRecord[];
  dataverseActions: DataverseActionRecord[];
}

/** "Change type" of the row trigger → SDK messages. */
const ROW_TRIGGER_MESSAGES: Record<number, string[]> = {
  1: ['Create'],
  2: ['Delete'],
  3: ['Update'],
  4: ['Create', 'Update'],
  5: ['Create', 'Delete'],
  6: ['Update', 'Delete'],
  7: ['Create', 'Update', 'Delete'],
};

const ROW_TRIGGER_SCOPES: Record<number, string> = {
  1: 'user',
  2: 'businessUnit',
  3: 'parentChildBusinessUnits',
  4: 'organization',
};

type Json = Record<string, any>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** A plain value; expressions (`@triggerOutputs()…`, `@{…}`) give null. */
function literal(value: unknown): string | null {
  const s = str(value);
  return s && !s.startsWith('@') && !s.includes('@{') ? s : null;
}

const lastSegment = (apiId: string) => apiId.split('/').filter(Boolean).pop() ?? null;

function readConnectionReferences(refs: unknown): ConnectionReferenceRecord[] {
  if (!isObject(refs)) return [];
  return Object.entries(refs)
    .map(([name, ref]) => ({
      name,
      logicalName: str(ref?.connection?.connectionReferenceLogicalName),
      connector: str(ref?.api?.name) ?? (str(ref?.api?.id) ? lastSegment(ref.api.id) : null),
    }))
    .sort((a, b) => compareStrings(a.name, b.name));
}

/** The connector an action or trigger calls: its apiId, else its connection reference's API. */
function connectorOf(host: unknown, refs: Map<string, ConnectionReferenceRecord>): string | null {
  if (!isObject(host)) return null;
  const apiId = str(host.apiId);
  if (apiId) return lastSegment(apiId);
  const connectionName = str(host.connectionName)
    ?? /\['([^']+)'\]\['connectionId'\]/.exec(String(host.connection?.name ?? ''))?.[1]
    ?? null;
  return connectionName ? refs.get(connectionName)?.connector ?? null : null;
}

/** Request triggers by kind; any other trigger by its connector. */
const REQUEST_KINDS: Record<string, TriggerKind> = {
  button: 'manual',
  powerapp: 'powerApps',
  powerappv2: 'powerApps',
  skills: 'copilot',
  virtualagent: 'copilot',
  powerpages: 'powerPages',
  http: 'http',
};

function triggerKind(trigger: Json, connector: string | null): TriggerKind {
  const type = str(trigger.type)?.toLowerCase();
  if (type === 'recurrence') return 'recurrence';
  const requestKind = type === 'request' ? REQUEST_KINDS[str(trigger.kind)?.toLowerCase() ?? ''] : undefined;
  if (requestKind) return requestKind;
  if (connector === DATAVERSE_CONNECTOR) return 'dataverse';
  return connector ? 'connector' : 'other';
}

function readTrigger(triggers: unknown, refs: Map<string, ConnectionReferenceRecord>): FlowTriggerRecord | null {
  if (!isObject(triggers)) return null;
  // Power Automate flows have exactly one trigger
  const name = Object.keys(triggers).sort(compareStrings)[0];
  const trigger = name !== undefined ? triggers[name] : null;
  if (!isObject(trigger)) return null;

  const inputs: Json = isObject(trigger.inputs) ? trigger.inputs : {};
  const connector = connectorOf(inputs.host, refs);
  const kind = triggerKind(trigger, connector);
  // "When a row is added, modified or deleted" has a change type, "When an action is performed" the message name
  const params: Json = kind === 'dataverse' && isObject(inputs.parameters) ? inputs.parameters : {};
  const sdkMessage = literal(params['subscriptionRequest/sdkmessagename']);
  return {
    name,
    kind,
    connector,
    operation: str(inputs.host?.operationId) ?? str(inputs.operationId),   // a BPF flow step trigger has it in inputs
    entity: logicalName(literal(params['subscriptionRequest/entityname'])),
    messages: sdkMessage ? [sdkMessage] : ROW_TRIGGER_MESSAGES[int(params['subscriptionRequest/message']) ?? -1] ?? [],
    scope: ROW_TRIGGER_SCOPES[int(params['subscriptionRequest/scope']) ?? -1] ?? null,
    filteringAttributes: nameList(literal(params['subscriptionRequest/filteringattributes'])),
    filterExpression: str(params['subscriptionRequest/filterexpression']),
  };
}

/** Every action, nested ones included (conditions, switches, scopes, loops). */
function* allActions(actions: unknown): Generator<[string, Json]> {
  if (!isObject(actions)) return;
  for (const [name, action] of Object.entries(actions)) {
    if (!isObject(action)) continue;
    yield [name, action];
    yield* allActions(action.actions);
    yield* allActions(action.else?.actions);
    if (isObject(action.cases)) {
      for (const branch of Object.values(action.cases)) yield* allActions(branch?.actions);
    }
    yield* allActions(action.default?.actions);
  }
}

function readDataverseActions(
  actions: unknown,
  refs: Map<string, ConnectionReferenceRecord>,
  entityOf: (entitySetName: string) => string | null,
): DataverseActionRecord[] {
  const out: DataverseActionRecord[] = [];
  for (const [name, action] of allActions(actions)) {
    const host = action.inputs?.host;
    if (connectorOf(host, refs) !== DATAVERSE_CONNECTOR) continue;
    const params: Json = isObject(action.inputs?.parameters) ? action.inputs.parameters : {};
    const entitySetName = literal(params.entityName);
    out.push({
      name,
      operation: str(host?.operationId) ?? str(action.inputs?.operationId),
      entity: entitySetName ? entityOf(entitySetName) : null,
      entitySetName,
      actionName: literal(params.actionName),
    });
  }
  return out.sort((a, b) => compareStrings(a.name, b.name));
}

/** Trigger, connection references and Dataverse actions of a cloud flow definition. */
export function analyzeFlowDefinition(flow: unknown, entityOf: (entitySetName: string) => string | null): FlowDefinitionFacts {
  const properties: Json = isObject(flow) && isObject(flow.properties) ? flow.properties : {};
  const connectionReferences = readConnectionReferences(properties.connectionReferences);
  const refs = new Map(connectionReferences.map((r) => [r.name, r]));
  const definition: Json = isObject(properties.definition) ? properties.definition : {};
  return {
    trigger: readTrigger(definition.triggers, refs),
    connectionReferences,
    dataverseActions: readDataverseActions(definition.actions, refs, entityOf),
  };
}
