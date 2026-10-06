// Synthetic fixture: the shared audit handler, named by its full type name.
using System.Collections.Generic;
using Dvt.Plugins.PluginFramework.Registrations;
using Dvt.Plugins.PluginFramework.Runtime;

namespace Dvt.Plugins.EntityPluginRegistrations.Invoice
{
    /// <summary>Entry point for Invoice Post-Operation asynchronous pipeline execution. PRT registration: Create, Post-Operation, Async.</summary>
    public class InvoicePostOperationAsyncPlugin : PipelinePluginBase
    {
        public InvoicePostOperationAsyncPlugin() : base(typeof(InvoicePostOperationAsyncPlugin)) { }

        public override string EntityLogicalName => "dvt_invoice";

        protected override PipelineExecutionMode ExecutionMode => PipelineExecutionMode.Async;

        /// <summary>Create, Post-Operation, Async; filtering attributes: none; PreImage: none; PostImage: none.</summary>
        public override IEnumerable<PipelineStepDescriptor> GetCreateSteps()
        {
            yield return new PipelineStepDescriptor
            {
                Type = PipelineComponentType.Handler,
                ImplementationType = typeof(global::Dvt.Plugins.Handlers.Common.AuditTrailHandler),
                Order = 10,
                Description = "Writes an audit trail entry; Create, Post-Operation, Async; filtering attributes: none; PreImage: none; PostImage: none"
            };
        }
    }
}
