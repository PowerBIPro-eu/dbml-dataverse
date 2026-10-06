# Validators/Meeting

Validators of the Meeting table. Synthetic dv-tools test fixture: the method bodies are left out; dv-tools reads only the declarations.

## Files

- `MeetingDateValidator.cs`: rejects a meeting that ends before it starts.

## Trigger points

Create and Update, Pre-Operation, Sync.

## Special assumptions

Stateless.
