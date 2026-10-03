// Platform SDK messages have the same sdkmessageid in every Dataverse environment, which is why
// an exported step can name its message by id alone. The ids below are the ones Microsoft Learn
// lists ("Use messages with the SDK for .NET"). Other messages (custom APIs and actions included)
// are taken from the step name.

const WELL_KNOWN_MESSAGES: Record<string, string> = {
  '8cbdbb1b-ea3e-db11-86a7-000a3a5473e8': 'Assign',
  '9ebdbb1b-ea3e-db11-86a7-000a3a5473e8': 'Create',
  'a1bdbb1b-ea3e-db11-86a7-000a3a5473e8': 'Delete',
  'c5bdbb1b-ea3e-db11-86a7-000a3a5473e8': 'GrantAccess',
  'dbbdbb1b-ea3e-db11-86a7-000a3a5473e8': 'Merge',
  'dcbdbb1b-ea3e-db11-86a7-000a3a5473e8': 'ModifyAccess',
  'f2bdbb1b-ea3e-db11-86a7-000a3a5473e8': 'Retrieve',
  '03bebb1b-ea3e-db11-86a7-000a3a5473e8': 'RetrieveMultiple',
  '04bebb1b-ea3e-db11-86a7-000a3a5473e8': 'RetrievePrincipalAccess',
  '10bebb1b-ea3e-db11-86a7-000a3a5473e8': 'RetrieveSharedPrincipalsAndAccess',
  '11bebb1b-ea3e-db11-86a7-000a3a5473e8': 'RevokeAccess',
  '1cbebb1b-ea3e-db11-86a7-000a3a5473e8': 'SetState',
  '1dbebb1b-ea3e-db11-86a7-000a3a5473e8': 'SetStateDynamicEntity',
  '20bebb1b-ea3e-db11-86a7-000a3a5473e8': 'Update',
};

export function sdkMessageName(id: string | null): string | null {
  return id ? WELL_KNOWN_MESSAGES[id] ?? null : null;
}

/** The Plugin Registration Tool names a step `<plugin type>: <Message> of <table>` (`of any Entity` without a table). */
export function parseStepName(name: string | null): { pluginType: string; message: string } | null {
  const m = name ? /^(.+?):\s*([^\s:]+)\s+of\s+.+$/i.exec(name.trim()) : null;
  return m ? { pluginType: m[1].trim(), message: m[2] } : null;
}
