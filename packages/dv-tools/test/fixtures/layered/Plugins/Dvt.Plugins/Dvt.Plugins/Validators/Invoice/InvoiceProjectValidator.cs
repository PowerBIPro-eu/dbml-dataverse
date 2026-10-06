// Synthetic fixture: a validator that the Invoice Pre-Validation plug-in runs on Create and Update.
using Microsoft.Xrm.Sdk;
using Dvt.Plugins.PluginFramework.Abstractions;
using Dvt.Plugins.PluginFramework.Runtime.Base;

namespace Dvt.Plugins.Validators.Invoice
{
    /// <summary>Rejects an invoice that does not belong to a project.</summary>
    public class InvoiceProjectValidator : IEntityValidator
    {
        /// <summary>
        /// Rejects an invoice without a project.
        /// PRT registration: Create and Update, Pre-Validation, Sync; filtering attributes: dvt_projectid;
        /// no PreImage; no PostImage. Works on the merged entity.
        /// </summary>
        public void Validate(ILocalPluginContext context, Entity entity)
        {
            // logic left out of the fixture
        }
    }
}
