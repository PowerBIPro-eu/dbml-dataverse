# PluginFramework/Registrations

The types entry plug-ins declare their steps with. Synthetic dv-tools test fixture: the method bodies are left out; dv-tools reads only the declarations.

## Files

- `EntityPluginRegistration.cs`: the step methods GetCreateSteps, GetUpdateSteps, GetDeleteSteps and GetSpecialSteps.
- `PipelineStepDescriptor.cs`: one step: Type, ImplementationType, Order and a registration-grade Description.
- `PipelineComponentType.cs`: Validator, Mutator or Handler.
- `PipelineExecutionMode.cs`: Sync or Async, as the entry plug-in is registered.

## Trigger points

None.

## Special assumptions

None.
