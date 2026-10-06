// Synthetic fixture: steps that Create and Update share, declared once in a method of the entry
// plug-in (GetSharedSteps) that GetCreateSteps() returns and GetUpdateSteps() includes in a foreach.
// This is the current framework, not the legacy engine's stage routing: dv-tools reads it as known.
using System.Collections.Generic;
using Dvt.Plugins.PluginFramework.Registrations;
using Dvt.Plugins.PluginFramework.Runtime;
using Dvt.Plugins.Validators.Invoice;

namespace Dvt.Plugins.EntityPluginRegistrations.Invoice
{
    /// <summary>Entry point for Invoice Pre-Validation pipeline execution. PRT registration: Create and Update, Pre-Validation, Sync.</summary>
    public class InvoicePreValidationPlugin : PipelinePluginBase
    {
        public InvoicePreValidationPlugin() : base(typeof(InvoicePreValidationPlugin)) { }

        /// <summary>Dataverse table this plug-in runs on.</summary>
        public override string EntityLogicalName => "dvt_invoice";

        /// <summary>Create, Pre-Validation, Sync: the shared steps; filtering attributes: none; PreImage: none; PostImage: none.</summary>
        public override IEnumerable<PipelineStepDescriptor> GetCreateSteps() => GetSharedSteps();

        /// <summary>
        /// Update, Pre-Validation, Sync: the shared steps and the lock of a paid invoice; filtering attributes: none;
        /// requires PreImage 'PreImage' with statuscode; no PostImage.
        /// </summary>
        public override IEnumerable<PipelineStepDescriptor> GetUpdateSteps()
        {
            foreach (var step in GetSharedSteps())
            {
                yield return step;
            }

            yield return new PipelineStepDescriptor
            {
                Type = PipelineComponentType.Validator,
                ImplementationType = typeof(InvoiceLockedValidator),
                Order = 5,
                Description = "Rejects changes to a paid invoice; Update, Pre-Validation, Sync; filtering attributes: none; PreImage 'PreImage' with statuscode; PostImage: none"
            };
        }

        /// <summary>The steps Create and Update share: Pre-Validation, Sync; filtering attributes: dvt_projectid; PreImage: none; PostImage: none.</summary>
        private static IEnumerable<PipelineStepDescriptor> GetSharedSteps()
        {
            yield return new PipelineStepDescriptor
            {
                Type = PipelineComponentType.Validator,
                ImplementationType = typeof(InvoiceProjectValidator),
                Order = 10,
                Description = "Rejects an invoice without a project; Create and Update, Pre-Validation, Sync; filtering attributes: dvt_projectid; PreImage: none; PostImage: none"
            };
        }
    }
}
