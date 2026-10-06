# PluginFramework/Abstractions

The pipeline contracts every step implements. Synthetic dv-tools test fixture: the method bodies are left out; dv-tools reads only the declarations.

## Files

- `IEntityValidator.cs`: contract of a validator: Validate runs on Pre-Operation steps and may block the operation.
- `IEntityMutator.cs`: contract of a mutator: Mutate sets column values before the operation is saved.
- `IEntityHandler.cs`: contract of a handler: Handle runs side effects after the operation.

## Trigger points

None: the contracts are called by PipelinePluginBase.

## Special assumptions

Implementations are stateless; the pipeline caches one instance per type.
