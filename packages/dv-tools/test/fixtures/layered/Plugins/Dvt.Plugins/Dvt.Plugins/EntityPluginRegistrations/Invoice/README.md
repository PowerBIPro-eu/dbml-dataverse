# EntityPluginRegistrations/Invoice

Entry plug-ins of the Invoice table (dvt_invoice). Synthetic dv-tools test fixture: the method bodies are left out; dv-tools reads only the declarations.

## Files

- `InvoicePreValidationPlugin.cs`: Create and Update, Pre-Validation, Sync: the project validator, which both messages share
  through `GetSharedSteps()`, and on Update the lock of a paid invoice. dv-tools reads the shared steps as part of both messages.
- `InvoicePreOperationPlugin.cs`: Create, Pre-Operation, Sync: the invoice total validator.
- `InvoicePostOperationAsyncPlugin.cs`: Create, Post-Operation, Async: the shared audit handler.
- `InvoicePostOperationSyncPlugin.cs`: derives from an intermediate base class on purpose: dv-tools reports it as unknown.

## Trigger points

Create and Update.

## Special assumptions

Only the Update step of `InvoicePreValidationPlugin` needs an image: the PreImage `PreImage` with statuscode.
