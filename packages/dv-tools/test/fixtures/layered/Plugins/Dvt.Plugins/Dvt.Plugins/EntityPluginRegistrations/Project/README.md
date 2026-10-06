# EntityPluginRegistrations/Project

Entry plug-ins of the Project table (dvt_project). Synthetic dv-tools test fixture: the method bodies are left out; dv-tools reads only the declarations.

## Files

- `ProjectPreOperationPlugin.cs`: Create and Update, Pre-Operation, Sync: budget and owner validators, the project code mutator.
- `ProjectPostOperationAsyncPlugin.cs`: Update and Assign, Post-Operation, Async: the notification handler and the shared audit handler.
- `ProjectPreValidationPlugin.cs`: Delete, Pre-Validation, Sync: the owner validator.

## Trigger points

Create, Update (filtering attributes: dvt_budget, ownerid, dvt_accountid, dvt_isactive) and Assign.

## Special assumptions

Update steps need the PreImage named 'PreImage' with the columns their descriptions list.
