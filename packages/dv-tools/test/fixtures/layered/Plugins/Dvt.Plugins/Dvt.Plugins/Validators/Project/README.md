# Validators/Project

Validators of the Project table. Synthetic dv-tools test fixture: the method bodies are left out; dv-tools reads only the declarations.

## Files

- `ProjectBudgetValidator.cs`: rejects a budget above the approved limit; sees the changed columns only.
- `ProjectOwnerValidator.cs`: only the project lead may hand a project over.

## Trigger points

Create and Update, Pre-Operation, Sync.

## Special assumptions

Stateless.
