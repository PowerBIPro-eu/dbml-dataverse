// Synthetic fixture: an entry plug-in behind an intermediate base class; dv-tools reports it and does not read it.
using System.Collections.Generic;
using Dvt.Plugins.Handlers.Common;
using Dvt.Plugins.PluginFramework.Registrations;
using Dvt.Plugins.PluginFramework.Runtime;

namespace Dvt.Plugins.EntityPluginRegistrations.Invoice
{
    public class InvoicePostOperationSyncPlugin : AuditedPipelinePluginBase
    {
        public InvoicePostOperationSyncPlugin() : base(typeof(InvoicePostOperationSyncPlugin)) { }

        /// <summary>Dataverse table this plug-in runs on.</summary>
        public override string EntityLogicalName => "dvt_invoice";

        /// <summary>Update, Post-Operation, Sync; filtering attributes: none; PreImage: none; PostImage: none.</summary>
        public override IEnumerable<PipelineStepDescriptor> GetUpdateSteps()
        {
            yield return new PipelineStepDescriptor
            {
                Type = PipelineComponentType.Handler,
                ImplementationType = typeof(AuditTrailHandler),
                Order = 10,
                Description = "Writes an audit trail entry; Update, Post-Operation, Sync; filtering attributes: none; PreImage: none; PostImage: none"
            };
        }
    }
}
