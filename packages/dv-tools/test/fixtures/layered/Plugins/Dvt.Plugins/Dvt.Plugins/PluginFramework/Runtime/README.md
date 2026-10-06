# PluginFramework/Runtime

The pipeline engine and an intermediate base class. Synthetic dv-tools test fixture: the method bodies are left out; dv-tools reads only the declarations.

## Files

- `PipelinePluginBase.cs`: the engine every entry plug-in derives from (left out of the fixture).
- `AuditedPipelinePluginBase.cs`: an intermediate base class; it is outside the architecture on purpose, so dv-tools reports the entry plug-in behind it as unknown.

## Trigger points

Every message an entry plug-in is registered on.

## Special assumptions

None.
