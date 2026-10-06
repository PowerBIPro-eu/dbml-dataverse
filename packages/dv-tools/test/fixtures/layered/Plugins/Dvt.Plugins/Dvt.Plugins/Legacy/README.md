# Legacy

A plug-in from before the pipeline architecture, still registered on steps. Synthetic dv-tools test fixture: the method bodies are left out; dv-tools reads only the declarations.

## Files

- `ValidateBudget.cs`: derives from PluginBase with its logic inline; dv-tools reports it as unknown.

## Trigger points

Update and Create of dvt_project (see the solution steps).

## Special assumptions

Outside the architecture on purpose.
