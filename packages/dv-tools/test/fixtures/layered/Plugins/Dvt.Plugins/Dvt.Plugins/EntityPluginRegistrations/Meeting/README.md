# EntityPluginRegistrations/Meeting

Entry plug-ins of the Meeting table (dvt_meeting). Synthetic dv-tools test fixture: the method bodies are left out; dv-tools reads only the declarations.

## Files

- `MeetingPreOperationPlugin.cs`: its Create steps depend on a condition on purpose, so dv-tools reports that message as unknown; its Update steps are readable.
- `MeetingPostOperationPlugin.cs`: Create, Post-Operation; neither its name nor its code says sync or async.
- `MeetingPreValidationPlugin.cs`: uses the legacy engine's GetRegistration() on purpose (steps in a nested registration class), so dv-tools reports it as unknown.

## Trigger points

Create and Update, Pre-Validation, Pre-Operation and Post-Operation (filtering attributes: scheduledstart, scheduledend).

## Special assumptions

Update needs the PreImage named 'PreImage' with scheduledstart, scheduledend.
