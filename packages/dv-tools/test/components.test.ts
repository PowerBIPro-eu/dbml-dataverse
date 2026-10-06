import { beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeFlowDefinition } from '../src/components/cloudFlow.js';
import { buildOutputs } from '../src/converter.js';
import { componentsOf, filesOf, layeredOptions, modelOf } from './helpers.js';

beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('components.json', () => {
  const result = buildOutputs(layeredOptions());
  const components = componentsOf(result);
  const byId = (list: any[], suffix: string) => list.find((c: any) => c.id.endsWith(suffix));
  const step = (suffix: string) => byId(components.pluginSteps, suffix);

  it('starts with componentsSchema and the provenance of model.json, and is written before model.json', () => {
    expect(Object.keys(components)).toEqual([
      'componentsSchema', 'provenance', 'pluginAssemblies', 'pluginTypes', 'pluginSteps', 'customApis',
      'cloudFlows', 'businessProcessFlows', 'classicWorkflows', 'pipelinesSource', 'pipelines',
    ]);
    expect(components.componentsSchema).toBe(1);
    expect(components.provenance).toEqual(modelOf(result).provenance);
    expect(result.files.map((f) => f.name).slice(-2)).toEqual(['components.json', 'model.json']);
  });

  it('leaves model.json and the .dv.dbml files exactly as without components', () => {
    const without = buildOutputs(layeredOptions({ writeComponents: false }));
    expect(filesOf(without).has('components.json')).toBe(false);
    expect(without.files).toEqual(result.files.filter((f) => f.name !== 'components.json'));
  });

  it('sorts every list by name, then id; custom APIs by unique name', () => {
    for (const key of ['pluginAssemblies', 'pluginTypes', 'pluginSteps', 'cloudFlows', 'businessProcessFlows', 'classicWorkflows']) {
      const keys = components[key].map((c: any) => `${c.name}\u0000${c.id}`);
      expect(keys, key).toEqual([...keys].sort());
    }
    expect(components.customApis.map((a: any) => a.uniqueName)).toEqual(['dvt_ArchiveProjects', 'dvt_CalculateBudget', 'dvt_RequestApproval']);
  });

  it('lists plugin assemblies and their types', () => {
    expect(components.pluginAssemblies).toEqual([{
      id: 'd7a5e000-0000-4000-8000-000000000001',
      name: 'Dvt.Plugins',
      version: '1.0.0.0',
      file: 'src/PluginAssemblies/DvtPlugins-D7A5E000-0000-4000-8000-000000000001/DvtPlugins.dll.data.xml',
      sourceSolution: 'Core',
    }]);
    // the workflow activity's Name is a friendly name: the full type name comes from the qualified name
    expect(components.pluginTypes.map((t: any) => [t.name, t.assembly, t.kind])).toEqual([
      ['Dvt.Plugins.Activities.CalculateEffort', 'Dvt.Plugins', 'workflowActivity'],
      ['Dvt.Plugins.Api.CalculateBudget', 'Dvt.Plugins', 'plugin'],
      ['Dvt.Plugins.Events.DispatchProjectEvent', 'Dvt.Plugins', 'plugin'],
      ['Dvt.Plugins.Invoice.CheckTotal', 'Dvt.Plugins', 'plugin'],
      ['Dvt.Plugins.Project.SetProjectCode', 'Dvt.Plugins', 'plugin'],
      ['Dvt.Plugins.Project.ValidateBudget', 'Dvt.Plugins', 'plugin'],
    ]);
  });

  it('reads a plugin step registration', () => {
    expect(step('201')).toEqual({
      id: 'd7a5e000-0000-4000-8000-000000000201',
      name: 'Dvt.Plugins.Project.ValidateBudget: Update of dvt_project',
      handlerKind: 'plugin',
      pluginType: 'Dvt.Plugins.Project.ValidateBudget',
      pluginTypeId: 'd7a5e000-0000-4000-8000-000000000101',
      assembly: 'Dvt.Plugins',
      serviceEndpoint: null,
      message: 'Update',
      messageId: '20bebb1b-ea3e-db11-86a7-000a3a5473e8',
      primaryEntity: 'dvt_project',
      stage: 20,
      stageName: 'preOperation',
      mode: 'sync',
      rank: 1,
      filteringAttributes: ['dvt_accountid', 'dvt_budget'],
      images: [{ name: 'PreImage', alias: 'PreImage', type: 'pre', attributes: ['dvt_accountid', 'dvt_budget'] }],
      file: 'src/SdkMessageProcessingSteps/{d7a5e000-0000-4000-8000-000000000201}.xml',
      sourceSolution: 'Core',
    });
    expect(step('203')).toMatchObject({
      stage: 40, stageName: 'postOperation', mode: 'async', rank: 2, filteringAttributes: [],
      images: [{ name: 'Snapshot', alias: 'Snapshot', type: 'both', attributes: [] }],
    });
  });

  it('names the message by its well-known id, else by the step name', () => {
    expect(step('205')).toMatchObject({ name: 'Recalculate effort on reassignment', message: 'Assign', primaryEntity: 'task' });
    // a custom action registered without a table (no PrimaryEntity): an event registration
    expect(step('204')).toMatchObject({ message: 'dvt_ProjectEvent', messageId: 'd7a5e000-0000-4000-8000-000000000301', primaryEntity: null });
    // neither a known id nor the naming convention
    expect(step('208')).toMatchObject({ name: 'Notify attendees', message: null, primaryEntity: 'dvt_meeting' });
  });

  it('fills the plugin type and assembly from the type id, else the type from the step name', () => {
    expect(step('205')).toMatchObject({ pluginType: 'Dvt.Plugins.Project.SetProjectCode', assembly: 'Dvt.Plugins' });
    // a plugin package step names its type only by PluginTypeExportKey
    expect(step('207')).toMatchObject({
      pluginType: 'Dvt.Packaged.Project.ArchiveProject', pluginTypeId: null, assembly: null, message: 'Delete', stageName: 'preValidation',
    });
  });

  it('tells plug-in steps from webhook and service endpoint steps', () => {
    expect(step('209')).toMatchObject({
      handlerKind: 'webhook', pluginType: null, pluginTypeId: null, assembly: null,
      serviceEndpoint: { id: 'd7a5e000-0000-4000-8000-000000000801', name: 'Project change webhook' },
      message: 'Update', primaryEntity: 'dvt_project', stageName: 'postOperation', mode: 'async',
    });
    expect(step('210')).toMatchObject({ handlerKind: 'serviceEndpoint', serviceEndpoint: { name: 'Project queue' } });
    // an endpoint that is not in the solution: a service endpoint, webhook or not
    expect(step('211')).toMatchObject({ handlerKind: 'serviceEndpoint', serviceEndpoint: { id: 'd7a5e000-0000-4000-8000-000000000899', name: null } });
    expect(components.pluginSteps.filter((s: any) => s.handlerKind !== 'plugin').map((s: any) => s.id.slice(-3)).sort()).toEqual(['209', '210', '211']);
    // they are not plug-in types, so they are not pipelines either
    expect(components.pipelines.map((p: any) => p.pluginType)).not.toContain('Project change webhook');
  });

  it('takes a component that is in several layers from the first one', () => {
    expect(step('202')).toMatchObject({ rank: 1, sourceSolution: 'Core' });   // Sales has it with rank 5
    expect(step('206')).toMatchObject({ primaryEntity: 'dvt_invoice', stageName: 'preValidation', sourceSolution: 'Sales' });
    expect(step('206').file).toBe('SdkMessageProcessingSteps/{d7a5e000-0000-4000-8000-000000000206}.xml');   // no src/ in Sales
  });

  describe('custom APIs', () => {
    const api = (uniqueName: string) => components.customApis.find((a: any) => a.uniqueName === uniqueName);

    it('reads the definition, its request parameters and response properties', () => {
      expect(api('dvt_CalculateBudget')).toEqual({
        uniqueName: 'dvt_CalculateBudget',
        displayName: 'Calculate budget',
        description: 'Calculates the budget of a project',
        bindingType: 'global',
        boundEntity: null,
        isFunction: true,
        isPrivate: false,
        allowedCustomProcessingStepType: 'none',
        executePrivilegeName: null,
        // named by export key, which is the type's id in PluginAssemblies
        pluginType: 'Dvt.Plugins.Api.CalculateBudget',
        pluginTypeId: 'd7a5e000-0000-4000-8000-000000000106',
        assembly: 'Dvt.Plugins',
        requestParameters: [
          { uniqueName: 'IncludeTasks', type: 'boolean', isOptional: true, entity: null },
          { uniqueName: 'ProjectId', type: 'guid', isOptional: false, entity: null },
        ],
        responseProperties: [
          { uniqueName: 'Budget', type: 'money', entity: null },
          { uniqueName: 'Project', type: 'entityReference', entity: 'dvt_project' },
        ],
        file: 'src/customapis/dvt_CalculateBudget/customapi.xml',
        sourceSolution: 'Core',   // Sales has it too, with another display name
      });
    });

    it('reads bound APIs, privileges and processing step types', () => {
      expect(api('dvt_ArchiveProjects')).toMatchObject({
        bindingType: 'entityCollection', boundEntity: 'dvt_project', isPrivate: true,
        allowedCustomProcessingStepType: 'asyncOnly', executePrivilegeName: 'prvDeletedvt_project',
        description: 'Archives closed projects',   // no English label: the default
        // a plug-in type that is not in the solution's PluginAssemblies keeps only its id
        pluginType: null, pluginTypeId: 'd7a5e000-0000-4000-8000-000000000107', assembly: null,
      });
      expect(api('dvt_RequestApproval')).toMatchObject({
        bindingType: 'entity', boundEntity: 'dvt_invoice', allowedCustomProcessingStepType: 'syncAndAsync',
        executePrivilegeName: null, pluginType: null, pluginTypeId: null, sourceSolution: 'Sales',
        requestParameters: [{ uniqueName: 'Comment', type: 'string', isOptional: true, entity: null }],
        responseProperties: [],
      });
    });
  });

  describe('cloud flows', () => {
    const flow = (suffix: string) => byId(components.cloudFlows, suffix);
    const action = (suffix: string, name: string) => flow(suffix).dataverseActions.find((a: any) => a.name === name);

    it('reads the Dataverse row trigger', () => {
      expect(flow('401')).toMatchObject({ id: 'd7a5e000-0000-4000-8000-000000000401', name: 'Notify the project owner', sourceSolution: 'Core' });
      expect(flow('401').trigger).toEqual({
        name: 'When_a_project_changes',
        kind: 'dataverse',
        connector: 'shared_commondataserviceforapps',
        operation: 'SubscribeWebhookTrigger',
        entity: 'dvt_project',
        messages: ['Update'],
        scope: 'organization',
        filteringAttributes: ['dvt_budget', 'dvt_isactive'],
        filterExpression: 'statecode eq 0',
      });
    });

    it('classifies other triggers', () => {
      expect(flow('402').trigger).toMatchObject({ kind: 'recurrence', connector: null, entity: null, messages: [] });
      expect(flow('404').trigger).toMatchObject({ name: 'manual', kind: 'powerApps' });

      const trigger = (t: object, connectionReferences: object = {}) =>
        analyzeFlowDefinition({ properties: { connectionReferences, definition: { triggers: { t } } } }, () => null).trigger;
      expect(trigger({ type: 'Request', kind: 'VirtualAgent' })!.kind).toBe('copilot');
      expect(trigger({ type: 'Request', kind: 'PowerPages' })!.kind).toBe('powerPages');
      expect(trigger({ type: 'Request', kind: 'Http' })!.kind).toBe('http');
      // "When an action is performed" names the message it runs on
      expect(trigger({
        type: 'OpenApiConnectionWebhook',
        inputs: {
          host: { connectionName: 'shared_commondataserviceforapps', operationId: 'BusinessEventsTrigger', apiId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps' },
          parameters: { 'subscriptionRequest/entityname': 'none', 'subscriptionRequest/sdkmessagename': 'dvt_ProjectEvent' },
        },
      })).toMatchObject({ kind: 'dataverse', operation: 'BusinessEventsTrigger', entity: null, messages: ['dvt_ProjectEvent'] });
      // "When a flow step is run from a business process flow": a Request with its connection in $connections
      expect(trigger(
        { type: 'Request', kind: 'ApiConnection', inputs: { host: { connection: { name: "@parameters('$connections')['shared_commondataserviceforapps']['connectionId']" } }, operationId: 'FlowStepRun' } },
        { shared_commondataserviceforapps: { api: { name: 'shared_commondataserviceforapps' } } },
      )).toMatchObject({ kind: 'dataverse', connector: 'shared_commondataserviceforapps', operation: 'FlowStepRun' });
    });

    it('lists connection references', () => {
      expect(flow('401').connectionReferences).toEqual([
        { name: 'shared_commondataserviceforapps', logicalName: 'dvt_dataverse', connector: 'shared_commondataserviceforapps' },
        { name: 'shared_office365', logicalName: 'dvt_office365', connector: 'shared_office365' },
      ]);
    });

    it('lists every Dataverse action, nested ones included, and no other connector', () => {
      // If (then and else), Foreach and Switch (case and default) branches; the Office 365 e-mail is left out
      expect(flow('401').dataverseActions.map((a: any) => a.name)).toEqual([
        'Get_the_customer', 'List_the_open_tasks', 'Mark_the_project_reviewed', 'Raise_a_project_event', 'Reset_the_effort',
      ]);
      expect(action('401', 'Get_the_customer')).toEqual({
        name: 'Get_the_customer', operation: 'GetItem', entity: 'account', entitySetName: 'accounts', actionName: null,
      });
      expect(action('401', 'Raise_a_project_event')).toMatchObject({ operation: 'PerformUnboundAction', entity: null, actionName: 'dvt_ProjectEvent' });
      expect(action('404', 'Request_the_approval')).toMatchObject({
        operation: 'PerformBoundAction', entity: 'dvt_invoice', actionName: 'Microsoft.Dynamics.CRM.dvt_RequestApproval',
      });
    });

    it('maps entity set names to tables of any layer, and keeps names it cannot map', () => {
      // flow 402's actions name their connection by a reference key only (no apiId)
      expect(action('402', 'Create_the_invoice')).toMatchObject({ operation: 'CreateRecord', entity: 'dvt_invoice', entitySetName: 'dvt_invoices' });
      expect(action('401', 'List_the_open_tasks')).toMatchObject({ entity: null, entitySetName: 'tasks' });   // Task's XML has no EntitySetName
      expect(action('402', 'List_the_rows_to_check')).toMatchObject({ entity: null, entitySetName: null });   // computed in the flow
    });
  });

  it('reads business process flow stages in order, with their table and branches', () => {
    const id = (n: number) => `d7a5e000-0000-4000-8000-000000000${n}`;
    expect(components.businessProcessFlows).toEqual([{
      id: id(501),
      name: 'Project lifecycle',
      uniqueName: 'dvt_projectlifecycle',
      primaryEntity: 'dvt_project',
      stages: [
        // the step label "Budget" inside the stage is not the stage's name
        { id: id(511), name: 'Plan', order: 1, category: 0, entity: 'dvt_project', nextStage: id(512), branches: [] },
        {
          id: id(512), name: 'Deliver', order: 2, category: 1, entity: 'dvt_project', nextStage: id(513),
          branches: [{ condition: 'If the project was stopped', nextStage: id(514) }],
        },
        { id: id(513), name: 'Review', order: 3, category: 123450000, entity: 'dvt_meeting', nextStage: id(514), branches: [] },
        { id: id(514), name: 'Close', order: 4, category: 3, entity: 'dvt_project', nextStage: null, branches: [] },   // name from DisplayName
      ],
      file: 'src/Workflows/Projectlifecycle-D7A5E000-0000-4000-8000-000000000501.xaml',
      sourceSolution: 'Core',
    }]);
  });

  it('lists classic workflows with id, name, category and table, and the scope of business rules; desktop flows are not read', () => {
    expect(components.classicWorkflows.map((w: any) => [w.name, w.category, w.primaryEntity, w.scope, w.forms])).toEqual([
      ['Budget is required for active projects', 'businessRule', 'dvt_project', 'entity', []],
      ['Close stale projects', 'workflow', 'dvt_project', null, []],
      ['Lock the budget on the summary form', 'businessRule', 'dvt_project', 'form', ['d7a5e000-0000-4000-8000-000000000701']],
      ['Project event', 'action', null, null, []],
      ['Show the end date on closed projects', 'businessRule', 'dvt_project', 'allForms', []],
    ]);
    expect(Object.keys(components.classicWorkflows[0])).toEqual(['id', 'name', 'category', 'primaryEntity', 'scope', 'forms', 'file', 'sourceSolution']);
    expect(JSON.stringify(components)).not.toContain('Export invoices');
  });
});
