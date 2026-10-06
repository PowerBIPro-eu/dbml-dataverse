import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildOutputs } from '../src/converter.js';
import { filteringAttributesOf, readPipelines } from '../src/components/pipelines.js';
import { componentsOf, layeredOptions } from './helpers.js';

beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('pipelines (C# entry plug-ins in the Plugins folder)', () => {
  const components = componentsOf(buildOutputs(layeredOptions()));
  const pipeline = (name: string) => components.pipelines.find((p: any) => p.pluginType.endsWith(`.${name}`));
  const message = (p: any, name: string | null) => p.messages.find((m: any) => m.message === name);
  const ids = (p: any, name: string | null) => message(p, name).components.map((c: any) => [c.position, c.order, c.kind, c.type.split('.').pop()]);

  it('names the Plugins folder relative to components.json; file paths are relative to it', () => {
    expect(components.pipelinesSource).toBe('../../Plugins');
    expect(Object.keys(components).slice(-2)).toEqual(['pipelinesSource', 'pipelines']);
  });

  it('reads an entry plug-in: table, stage, mode, registration and its components in run order', () => {
    const pre = pipeline('ProjectPreOperationPlugin');
    expect(pre).toMatchObject({
      pluginType: 'Dvt.Plugins.EntityPluginRegistrations.Project.ProjectPreOperationPlugin',
      registered: true,          // a step of the solution runs it
      entity: 'dvt_project',     // from the early-bound class's EntityLogicalName constant
      stage: 20, stageName: 'preOperation', mode: 'sync', composition: 'known', reason: null,
      file: 'Dvt.Plugins/Dvt.Plugins/EntityPluginRegistrations/Project/ProjectPreOperationPlugin.cs',
    });
    expect(pre.messages.map((m: any) => [m.message, m.method, m.composition, m.reason])).toEqual([
      ['Create', 'GetCreateSteps', 'known', null], ['Update', 'GetUpdateSteps', 'known', null],
    ]);
    // declared 20, 10, 30: they run by Order
    expect(ids(pre, 'Update')).toEqual([
      [1, 10, 'validator', 'ProjectOwnerValidator'], [2, 20, 'validator', 'ProjectBudgetValidator'], [3, 30, 'mutator', 'ProjectCodeMutator'],
    ]);
    expect(message(pre, 'Update').components[1]).toEqual({
      position: 2,
      order: 20,
      type: 'Dvt.Plugins.Validators.Project.ProjectBudgetValidator',
      kind: 'validator',
      declaredFilteringAttributes: ['dvt_budget'],
      description: "Rejects a budget above the approved limit; Update, Pre-Operation, Sync; filtering attributes: dvt_budget; PreImage 'PreImage' with dvt_budget; PostImage: none",
      file: 'Dvt.Plugins/Dvt.Plugins/Validators/Project/ProjectBudgetValidator.cs',
    });
    expect(message(pre, 'Create').components[0].declaredFilteringAttributes).toEqual([]);   // "filtering attributes: none"
  });

  it('runs steps with the same Order by full type name, and reads GetSpecialSteps and returned arrays', () => {
    const post = pipeline('ProjectPostOperationAsyncPlugin');
    expect(post).toMatchObject({ registered: false, stage: 40, stageName: 'postOperation', mode: 'async', composition: 'known' });
    expect(ids(post, 'Update')).toEqual([[1, 10, 'handler', 'AuditTrailHandler'], [2, 10, 'handler', 'ProjectNotificationHandler']]);
    // every message other than Create, Update and Delete; its description names no filtering attributes
    expect(post.messages.at(-1)).toMatchObject({ message: null, method: 'GetSpecialSteps', composition: 'known' });
    expect(post.messages.at(-1).components[0].declaredFilteringAttributes).toBeNull();
  });

  it('lists a component that entry plug-ins of several tables run under each of them', () => {
    const runBy = components.pipelines
      .filter((p: any) => p.messages.some((m: any) => m.components.some((c: any) => c.type === 'Dvt.Plugins.Handlers.Common.AuditTrailHandler')))
      .map((p: any) => p.entity);
    expect([...new Set(runBy)]).toEqual(['dvt_invoice', 'dvt_meeting', 'dvt_project']);
    // a file-scoped namespace and the table as a string literal
    expect(pipeline('InvoicePreOperationPlugin')).toMatchObject({ entity: 'dvt_invoice', composition: 'known' });
  });

  it('marks only the message it cannot read as unknown; readable messages keep their components', () => {
    const meeting = pipeline('MeetingPreOperationPlugin');
    expect(meeting).toMatchObject({ entity: 'dvt_meeting', composition: 'known', reason: null });
    expect(message(meeting, 'Create')).toEqual({
      message: 'Create', method: 'GetCreateSteps', composition: 'unknown', components: [],
      reason: 'MeetingPreOperationPlugin.GetCreateSteps is not a list of "yield return new PipelineStepDescriptor { … }" statements (it has a "if" statement)',
    });
    expect(message(meeting, 'Update')).toMatchObject({ composition: 'known', reason: null });
    expect(ids(meeting, 'Update')).toEqual([[1, 10, 'validator', 'MeetingDateValidator']]);
  });

  it('takes the stage from Pre-Validation and plain Post-Operation names; the mode only when it is certain', () => {
    expect(pipeline('ProjectPreValidationPlugin')).toMatchObject({ stage: 10, stageName: 'preValidation', mode: 'sync', composition: 'known' });   // always synchronous
    expect(pipeline('MeetingPostOperationPlugin')).toMatchObject({ stage: 40, stageName: 'postOperation', mode: null, composition: 'known' });   // no ExecutionMode
  });

  it('reports plug-ins it does not read as composition "unknown", with the reason', () => {
    // the legacy engine: table and steps in a separate registration object
    expect(pipeline('MeetingPreValidationPlugin')).toMatchObject({
      composition: 'unknown', messages: [], entity: null,
      reason: "MeetingPreValidationPlugin declares GetRegistration(): the legacy engine's separate registration",
    });
    // an entry plug-in behind an intermediate base class
    expect(pipeline('InvoicePostOperationSyncPlugin')).toMatchObject({
      composition: 'unknown', messages: [], registered: false,
      reason: 'InvoicePostOperationSyncPlugin derives from PipelinePluginBase through AuditedPipelinePluginBase, not directly',
    });
    // a registered plug-in outside the architecture, and one without code in the folder
    expect(pipeline('ValidateBudget')).toMatchObject({
      registered: true, composition: 'unknown', reason: 'ValidateBudget derives from PluginBase, not PipelinePluginBase',
      file: 'Dvt.Plugins/Dvt.Plugins/Legacy/ValidateBudget.cs',
    });
    expect(pipeline('CheckTotal')).toEqual({
      pluginType: 'Dvt.Plugins.Invoice.CheckTotal', registered: true, entity: null, stage: null, stageName: null, mode: null,
      composition: 'unknown', reason: 'not found in the Plugins folder', messages: [], file: null,
    });
    // a Custom API implementation (not registered on a step)
    expect(pipeline('CalculateBudget')).toMatchObject({
      pluginType: 'Dvt.Plugins.Api.CalculateBudget', registered: false, composition: 'unknown',
      reason: 'implements the Custom API dvt_CalculateBudget; CalculateBudget derives from PluginBase, not PipelinePluginBase',
    });
    expect(components.pipelines.map((p: any) => p.pluginType)).not.toContain('Dvt.Plugins.Generated.IgnoredPreOperationPlugin');   // obj/
  });

  it('is empty, with no source, without a Plugins folder', () => {
    const without = componentsOf(buildOutputs(layeredOptions({ pluginsPath: null })));
    expect([without.pipelinesSource, without.pipelines]).toEqual([null, []]);
  });
});

describe('pipeline code that does not follow the architecture', () => {
  let tmp: string;
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  /** A Plugins folder with these files (path → C#), read with `registered` as the registered plug-in types. */
  function pipelinesOf(files: Record<string, string>, registered: string[] = []) {
    tmp = mkdtempSync(join(tmpdir(), 'dv-pipelines-'));
    for (const [path, code] of Object.entries(files)) {
      mkdirSync(join(tmp, path, '..'), { recursive: true });
      writeFileSync(join(tmp, path), code);
    }
    return readPipelines(tmp, registered, [], () => {});
  }

  const entry = (steps: string, extra = '') => `
    namespace X.EntityPluginRegistrations {
      public class APreOperationPlugin : PipelinePluginBase {
        public override string EntityLogicalName => "x_a";
        ${extra}
        public override IEnumerable<PipelineStepDescriptor> GetCreateSteps() { ${steps} }
      }
    }`;
  const step = (type: string, impl: string, order = '10', description = '"d"') =>
    `yield return new PipelineStepDescriptor { Type = PipelineComponentType.${type}, ImplementationType = typeof(${impl}), Order = ${order}, Description = ${description} };`;
  const component = (name: string, iface: string, ns = 'X') => `namespace ${ns} { public class ${name} : ${iface} { } }`;
  const createReason = (pipelines: any[]) => pipelines[0].messages[0].reason;

  it('a component that implements another kind than it is declared as makes its message unknown', () => {
    const [p] = pipelinesOf({ 'A.cs': entry(step('Validator', 'X.Fixer')), 'Fixer.cs': component('Fixer', 'IEntityMutator') });
    expect(p.composition).toBe('known');
    expect(p.messages[0]).toMatchObject({ composition: 'unknown', reason: 'Fixer is declared as a validator but implements IEntityMutator', components: [] });
  });

  it('a component that is not in the folder, or ambiguous', () => {
    expect(createReason(pipelinesOf({ 'A.cs': entry(step('Validator', 'Missing')) })))
      .toBe('APreOperationPlugin.GetCreateSteps: Missing is not in the Plugins folder');
    const ambiguous = pipelinesOf({
      'A.cs': `using P; using Q; ${entry(step('Handler', 'H'))}`,
      'P.cs': component('H', 'IEntityHandler', 'P'),
      'Q.cs': component('H', 'IEntityHandler', 'Q'),
    });
    expect(createReason(ambiguous)).toBe('APreOperationPlugin.GetCreateSteps: H is ambiguous (P.H, Q.H)');
  });

  it('stage-specific step methods of the legacy engine (the whole plug-in), and an Order that is not a number', () => {
    const legacy = pipelinesOf({ 'A.cs': entry(step('Handler', 'X.H'), 'public IEnumerable<PipelineStepDescriptor> GetPreOperationCreateSteps() { yield break; }'), 'H.cs': component('H', 'IEntityHandler') });
    expect(legacy[0]).toMatchObject({ composition: 'unknown', messages: [], reason: 'APreOperationPlugin declares GetPreOperationCreateSteps: stage-specific step methods of the legacy engine' });
    const order = pipelinesOf({ 'A.cs': entry(step('Handler', 'X.H', 'Orders.First')), 'H.cs': component('H', 'IEntityHandler') });
    expect(createReason(order)).toBe('APreOperationPlugin.GetCreateSteps: Order of X.H is not a number');
  });

  it('keeps a composition with a description it cannot evaluate, without filtering attributes', () => {
    const [p] = pipelinesOf({ 'A.cs': entry(step('Handler', 'X.H', '10', '$"filtering attributes: {Columns}"')), 'H.cs': component('H', 'IEntityHandler') });
    expect(p.messages[0]).toMatchObject({ composition: 'known' });
    expect(p.messages[0].components[0]).toMatchObject({ description: null, declaredFilteringAttributes: null });
  });

  it('a registered plug-in type in a file it cannot read', () => {
    const [p] = pipelinesOf({ 'Broken.cs': 'namespace X { public class Broken : PipelinePluginBase { void M() { "unterminated } }' }, ['X.Broken']);
    expect(p).toMatchObject({ pluginType: 'X.Broken', registered: true, composition: 'unknown', reason: 'unterminated string in Broken.cs', file: 'Broken.cs' });
  });

  it('reads filtering attributes only from a column list or "none"', () => {
    expect(filteringAttributesOf('Update, Pre-Operation, Sync; filtering attributes: OwnerId, dvt_budget; PreImage: none')).toEqual(['dvt_budget', 'ownerid']);
    expect(filteringAttributesOf('filtering attributes: none.')).toEqual([]);
    expect(filteringAttributesOf('filtering attributes: as registered')).toBeNull();
    expect(filteringAttributesOf('Update, Pre-Operation, Sync')).toBeNull();
  });
});
