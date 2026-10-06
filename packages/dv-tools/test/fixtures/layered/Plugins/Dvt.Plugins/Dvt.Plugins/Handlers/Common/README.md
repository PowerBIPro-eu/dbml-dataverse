# Handlers/Common

Handlers that entry plug-ins of several tables run. Synthetic dv-tools test fixture: the method bodies are left out; dv-tools reads only the declarations.

## Files

- `AuditTrailHandler.cs`: writes an audit trail entry (run for Project and Invoice).

## Trigger points

Post-Operation, Async.

## Special assumptions

Stateless.
