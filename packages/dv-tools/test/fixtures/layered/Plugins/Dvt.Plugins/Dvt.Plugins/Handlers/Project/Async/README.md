# Handlers/Project/Async

Asynchronous handlers of the Project table. Synthetic dv-tools test fixture: the method bodies are left out; dv-tools reads only the declarations.

## Files

- `ProjectNotificationHandler.cs`: tells the owner that the project was stopped.

## Trigger points

Update, Post-Operation, Async (filtering attributes: dvt_isactive).

## Special assumptions

Needs the PreImage named 'PreImage' with dvt_isactive.
