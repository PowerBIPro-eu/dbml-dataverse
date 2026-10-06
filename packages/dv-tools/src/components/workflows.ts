import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listDir, portableRelative } from '../util.js';
import { analyzeFlowDefinition, type FlowDefinitionFacts } from './cloudFlow.js';
import {
  componentXmlParser, guid, int, label1033, localName, logicalName, parseXmlTree, readText, text, type XmlNode,
} from './xml.js';

// Processes in Workflows/: each has <name>-<id>.data.xml (id, name, category, primary table) next to
// its definition — <name>-<id>.json for a cloud flow, <name>-<id>.xaml for everything else.

export interface CloudFlowRecord extends FlowDefinitionFacts {
  id: string | null;
  name: string | null;
  file: string;
}

export interface BpfBranchRecord {
  condition: string | null;        // the condition's label
  nextStage: string | null;
}

export interface BpfStageRecord {
  id: string | null;
  name: string | null;
  order: number;                   // position in the process definition, from 1
  category: number | null;         // StageCategory option value
  entity: string | null;           // the table the stage is on
  nextStage: string | null;        // the next stage; with branches, the one when no condition applies
  branches: BpfBranchRecord[];     // conditions that lead out of the stage
}

export interface BusinessProcessFlowRecord {
  id: string | null;
  name: string | null;
  uniqueName: string | null;       // the table that holds the process instances
  primaryEntity: string | null;
  stages: BpfStageRecord[];
  file: string;
}

export type ClassicCategory = 'workflow' | 'dialog' | 'businessRule' | 'action';

/** Where a business rule runs: on the table (every form and the server), on all forms, or on one form. */
export type BusinessRuleScope = 'entity' | 'allForms' | 'form';

export interface ClassicWorkflowRecord {
  id: string | null;
  name: string | null;
  category: ClassicCategory;
  primaryEntity: string | null;
  scope: BusinessRuleScope | null;   // business rules only
  forms: string[];                   // form ids of a form-scoped business rule
  file: string;
}

export interface WorkflowFiles {
  cloudFlows: CloudFlowRecord[];
  businessProcessFlows: BusinessProcessFlowRecord[];
  classicWorkflows: ClassicWorkflowRecord[];
}

/** Workflow Category values; 4 is a business process flow, 5 a cloud flow; desktop flows (6) and others are not read. */
const CLASSIC_CATEGORIES: Record<number, ClassicCategory> = { 0: 'workflow', 1: 'dialog', 2: 'businessRule', 3: 'action' };
const BUSINESS_RULE_CATEGORY = 2;
const BPF_CATEGORY = 4;
const CLOUD_FLOW_CATEGORY = 5;

/** ProcessTriggerScope 2 (Entity), or 1 (Form) with ProcessTriggerFormId for one form and without for all forms. */
function businessRuleScope(workflow: any): Pick<ClassicWorkflowRecord, 'scope' | 'forms'> {
  const scope = int(workflow.ProcessTriggerScope);
  const form = guid(workflow.ProcessTriggerFormId);
  if (scope === 2) return { scope: 'entity', forms: [] };
  if (scope === 1) return form ? { scope: 'form', forms: [form] } : { scope: 'allForms', forms: [] };
  return { scope: null, forms: [] };
}

const DATA_XML = '.data.xml';

/** The definition next to a .data.xml: as named in JsonFileName/XamlFileName, else the same name without .data.xml. */
function definitionFile(root: string, dir: string, dataFile: string, workflow: any): string | null {
  const declared = text(workflow.JsonFileName) ?? text(workflow.XamlFileName);
  const candidates = [
    declared ? join(root, declared.replace(/^[\\/]+/, '')) : null,
    join(dir, dataFile.slice(0, -DATA_XML.length)),
  ];
  return candidates.find((c): c is string => !!c && existsSync(c)) ?? null;
}

// ── Business process flow stages (XAML) ────────────────────────────────────

// Each stage sits in an entity step of its own (`DisplayName="EntityStep1: dvt_project"`); conditions
// that lead out of a stage sit inside it, each branch's Then ending in a SetNextStage.
const ENTITY_STEP = 'Microsoft.Crm.Workflow.Activities.EntityComposite';
const STAGE_STEP = 'Microsoft.Crm.Workflow.Activities.StageComposite';
const CONDITION_BRANCH = 'Microsoft.Crm.Workflow.Activities.ConditionBranch';

const propertiesOf = (node: XmlNode) => node.children.find((c) => localName(c) === 'ActivityReference.Properties');

/** `<x:String x:Key="StageId">…</x:String>` values directly under an activity's Properties; x:Null gives null. */
function activityProperties(node: XmlNode): Map<string, string | null> {
  const props = new Map<string, string | null>();
  for (const child of propertiesOf(node)?.children ?? []) {
    const key = child.attrs['x:Key'];
    if (key) props.set(key, localName(child) === 'Null' ? null : text(child.text));
  }
  return props;
}

/** `StageStep3: Review` → `Review`. */
function afterStepPrefix(displayName: string | undefined): string | null {
  const colon = displayName?.indexOf(':') ?? -1;
  return colon >= 0 ? text(displayName!.slice(colon + 1)) : null;
}

/** The stage's English label, else the name in its DisplayName. */
function stageName(stage: XmlNode): string | null {
  const labels = propertiesOf(stage)?.children.find((c) => c.attrs['x:Key'] === 'StepLabels');
  const english = labels?.children.find((l) => localName(l) === 'StepLabel' && l.attrs.LanguageCode === '1033');
  return text(english?.attrs.Description) ?? afterStepPrefix(stage.attrs.DisplayName);
}

/** Stages in document order, with their table and the conditions that lead out of them. */
export function readBpfStages(xaml: string): BpfStageRecord[] {
  const stages: BpfStageRecord[] = [];
  const branches = new Map<string, BpfBranchRecord[]>();   // source stage id → branches

  // `inThen`: inside a condition branch's Then (with the condition's label)
  const walk = (nodes: XmlNode[], entity: string | null, stageId: string | null, inThen: { condition: string | null } | null) => {
    for (const node of nodes) {
      const activity = localName(node) === 'ActivityReference' ? node.attrs.AssemblyQualifiedName ?? '' : '';
      if (activity.startsWith(ENTITY_STEP)) {
        walk(node.children, logicalName(afterStepPrefix(node.attrs.DisplayName)), stageId, null);
      } else if (activity.startsWith(STAGE_STEP)) {
        const props = activityProperties(node);
        const stage: BpfStageRecord = {
          id: guid(props.get('StageId')),
          name: stageName(node),
          order: stages.length + 1,
          category: int(props.get('StageCategory')),
          entity,
          nextStage: guid(props.get('NextStageId')),
          branches: [],
        };
        stages.push(stage);
        walk(node.children, entity, stage.id, null);
      } else if (activity.startsWith(CONDITION_BRANCH)) {
        const condition = text(activityProperties(node).get('Description'));
        for (const part of propertiesOf(node)?.children ?? []) {
          walk([part], entity, stageId, part.attrs['x:Key'] === 'Then' ? { condition } : null);   // Else: further branches
        }
      } else if (localName(node) === 'SetNextStage') {
        const source = guid(node.attrs.ParentStageId) ?? stageId;
        if (inThen && source) branches.set(source, [...(branches.get(source) ?? []), { condition: inThen.condition, nextStage: guid(node.attrs.StageId) }]);
      } else {
        walk(node.children, entity, stageId, inThen);
      }
    }
  };
  walk(parseXmlTree(xaml), null, null, null);
  for (const stage of stages) stage.branches = branches.get(stage.id ?? '') ?? [];
  return stages;
}

// ── Workflows folder ───────────────────────────────────────────────────────

/** Cloud flows, business process flows and classic workflows of one solution folder. */
export function readWorkflows(
  root: string,
  layerPath: string,
  entityOf: (entitySetName: string) => string | null,
  warn: (message: string) => void,
): WorkflowFiles {
  const out: WorkflowFiles = { cloudFlows: [], businessProcessFlows: [], classicWorkflows: [] };
  const dir = join(root, 'Workflows');
  if (!existsSync(dir)) return out;

  const files = listDir(dir, 'files');
  const described = new Set<string>();   // definitions that have a .data.xml (lowercase paths)

  for (const fn of files.filter((f) => f.toLowerCase().endsWith(DATA_XML))) {
    const path = join(dir, fn);
    let workflow: any;
    try {
      workflow = componentXmlParser.parse(readText(path))?.Workflow;
    } catch (err: any) {
      warn(`could not read ${path}: ${err?.message ?? err}`);
      continue;
    }
    if (!workflow) continue;

    const definition = definitionFile(root, dir, fn, workflow);
    if (definition) described.add(definition.toLowerCase());
    const id = guid(workflow['@_WorkflowId']);
    const name = text(workflow['@_Name']) ?? label1033(workflow.LocalizedNames?.LocalizedName);
    const category = int(workflow.Category);
    const primaryEntity = logicalName(workflow.PrimaryEntity);
    const file = portableRelative(layerPath, definition ?? path);

    if (category === CLOUD_FLOW_CATEGORY) {
      let flow: unknown = null;
      if (!definition) warn(`${path}: the cloud flow definition (.json) is missing`);
      else {
        try { flow = JSON.parse(readText(definition)); } catch (err: any) { warn(`could not read ${definition}: ${err?.message ?? err}`); }
      }
      out.cloudFlows.push({ id, name, ...analyzeFlowDefinition(flow, entityOf), file });
    } else if (category === BPF_CATEGORY) {
      let stages: BpfStageRecord[] = [];
      if (!definition) warn(`${path}: the business process flow definition (.xaml) is missing`);
      else {
        try { stages = readBpfStages(readText(definition)); } catch (err: any) { warn(`could not read ${definition}: ${err?.message ?? err}`); }
      }
      out.businessProcessFlows.push({ id, name, uniqueName: logicalName(workflow.UniqueName), primaryEntity, stages, file });
    } else if (category !== null && CLASSIC_CATEGORIES[category]) {
      // business process flows have a ProcessTriggerScope too: it is read for business rules only
      const scope = category === BUSINESS_RULE_CATEGORY ? businessRuleScope(workflow) : { scope: null, forms: [] };
      out.classicWorkflows.push({ id, name, category: CLASSIC_CATEGORIES[category], primaryEntity, ...scope, file });
    }
  }

  for (const fn of files.filter((f) => f.toLowerCase().endsWith('.json'))) {
    if (!described.has(join(dir, fn).toLowerCase())) warn(`${join(dir, fn)} has no ${fn}${DATA_XML}; skipped`);
  }
  return out;
}
