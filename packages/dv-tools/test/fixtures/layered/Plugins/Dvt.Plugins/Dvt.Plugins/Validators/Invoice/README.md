# Validators/Invoice

Validators of the Invoice table. Synthetic dv-tools test fixture: the method bodies are left out; dv-tools reads only the declarations.

## Files

- `InvoiceTotalValidator.cs`: rejects an invoice without a total.
- `InvoiceProjectValidator.cs`: rejects an invoice without a project.
- `InvoiceLockedValidator.cs`: rejects changes to a paid invoice.

## Trigger points

- `InvoiceTotalValidator`: Create, Pre-Operation, Sync.
- `InvoiceProjectValidator`: Create and Update, Pre-Validation, Sync; filtering attributes: dvt_projectid.
- `InvoiceLockedValidator`: Update, Pre-Validation, Sync; filtering attributes: none.

## Special assumptions

Stateless. `InvoiceLockedValidator` needs the PreImage `PreImage` with statuscode.
