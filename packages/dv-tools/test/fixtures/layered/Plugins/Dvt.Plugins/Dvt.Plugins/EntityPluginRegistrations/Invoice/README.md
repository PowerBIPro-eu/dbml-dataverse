# EntityPluginRegistrations/Invoice

Entry plug-ins of the Invoice table (dvt_invoice). Synthetic dv-tools test fixture: the method bodies are left out; dv-tools reads only the declarations.

## Files

- `InvoicePreOperationPlugin.cs`: Create, Pre-Operation, Sync: the invoice total validator.
- `InvoicePostOperationAsyncPlugin.cs`: Create, Post-Operation, Async: the shared audit handler.
- `InvoicePostOperationSyncPlugin.cs`: derives from an intermediate base class on purpose: dv-tools reports it as unknown.

## Trigger points

Create and Update.

## Special assumptions

No images.
