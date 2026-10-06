// Synthetic fixture: a validator that the Invoice Pre-Validation plug-in runs on Update only.
using Microsoft.Xrm.Sdk;
using Dvt.Plugins.PluginFramework.Abstractions;
using Dvt.Plugins.PluginFramework.Runtime.Base;

namespace Dvt.Plugins.Validators.Invoice
{
    /// <summary>Rejects changes to an invoice that is already paid.</summary>
    public class InvoiceLockedValidator : IEntityValidator
    {
        /// <summary>
        /// Rejects changes to a paid invoice.
        /// PRT registration: Update, Pre-Validation, Sync; filtering attributes: none;
        /// requires PreImage 'PreImage' with statuscode; no PostImage. Works on the merged entity.
        /// </summary>
        public void Validate(ILocalPluginContext context, Entity entity)
        {
            // logic left out of the fixture
        }
    }
}
