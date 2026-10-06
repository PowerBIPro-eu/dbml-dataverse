// Synthetic fixture: a file-scoped namespace, and the table as a string literal.
using System.Collections.Generic;
using Dvt.Plugins.PluginFramework.Registrations;
using Dvt.Plugins.PluginFramework.Runtime;
using Dvt.Plugins.Validators.Invoice;

namespace Dvt.Plugins.EntityPluginRegistrations.Invoice;

/// <summary>Entry point for Invoice Pre-Operation pipeline execution. PRT registration: Create, Pre-Operation, Sync.</summary>
public class InvoicePreOperationPlugin : PipelinePluginBase
{
    public InvoicePreOperationPlugin() : base(typeof(InvoicePreOperationPlugin)) { }

    public override string EntityLogicalName => "dvt_invoice";

    /// <summary>Create, Pre-Operation, Sync; filtering attributes: none; PreImage: none; PostImage: none.</summary>
    public override IEnumerable<PipelineStepDescriptor> GetCreateSteps()
    {
        yield return new PipelineStepDescriptor
        {
            Type = PipelineComponentType.Validator,
            ImplementationType = typeof(InvoiceTotalValidator),
            Order = 10,
            Description = "Rejects an invoice without a total; Create, Pre-Operation, Sync; filtering attributes: none; PreImage: none; PostImage: none"
        };
    }
}
