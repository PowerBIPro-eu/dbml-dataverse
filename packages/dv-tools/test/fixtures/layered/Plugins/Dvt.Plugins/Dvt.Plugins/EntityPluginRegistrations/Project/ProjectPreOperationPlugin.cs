// Synthetic fixture: an entry plug-in of the DDSol plug-in architecture. The Update steps are
// declared out of order on purpose: they run by Order.
using System.Collections.Generic;
using Dvt.Plugins.Model;
using Dvt.Plugins.Mutators.Project;
using Dvt.Plugins.PluginFramework.Registrations;
using Dvt.Plugins.PluginFramework.Runtime;
using Dvt.Plugins.Validators.Project;

namespace Dvt.Plugins.EntityPluginRegistrations.Project
{
    /// <summary>
    /// Entry point for Project Pre-Operation pipeline execution.
    /// PRT registration: Create, Update, Pre-Operation, Sync; filtering attributes: dvt_budget,ownerid,dvt_accountid;
    /// requires PreImage 'PreImage' with dvt_budget,ownerid,dvt_accountid; no PostImage.
    /// </summary>
    public class ProjectPreOperationPlugin : PipelinePluginBase
    {
        public ProjectPreOperationPlugin() : base(typeof(ProjectPreOperationPlugin)) { }

        /// <summary>Dataverse table this plug-in runs on.</summary>
        public override string EntityLogicalName => dvt_project.EntityLogicalName;

        /// <summary>Create, Pre-Operation, Sync; filtering attributes: none; PreImage: none; PostImage: none.</summary>
        public override IEnumerable<PipelineStepDescriptor> GetCreateSteps()
        {
            yield return new PipelineStepDescriptor
            {
                Type = PipelineComponentType.Validator,
                ImplementationType = typeof(ProjectBudgetValidator),
                Order = 10,
                Description = "Rejects a budget above the approved limit; Create, Pre-Operation, Sync; "
                    + "filtering attributes: none; PreImage: none; PostImage: none"
            };
            yield return new PipelineStepDescriptor
            {
                Type = PipelineComponentType.Mutator,
                ImplementationType = typeof(ProjectCodeMutator),
                Order = 20,
                Description = "Sets the project code from the customer; Create, Pre-Operation, Sync; filtering attributes: none; PreImage: none; PostImage: none"
            };
        }

        /// <summary>Update, Pre-Operation, Sync; filtering attributes: dvt_budget,ownerid,dvt_accountid; PreImage 'PreImage' with the same; PostImage: none.</summary>
        public override IEnumerable<PipelineStepDescriptor> GetUpdateSteps()
        {
            yield return new PipelineStepDescriptor
            {
                Type = PipelineComponentType.Validator,
                ImplementationType = typeof(ProjectBudgetValidator),
                Order = 20,
                Description = "Rejects a budget above the approved limit; Update, Pre-Operation, Sync; filtering attributes: dvt_budget; PreImage 'PreImage' with dvt_budget; PostImage: none"
            };
            yield return new PipelineStepDescriptor
            {
                Type = PipelineComponentType.Validator,
                ImplementationType = typeof(ProjectOwnerValidator),
                Order = 10,
                Description = "Only the project lead may hand a project over; Update, Pre-Operation, Sync; filtering attributes: ownerid; PreImage 'PreImage' with ownerid; PostImage: none"
            };
            yield return new PipelineStepDescriptor
            {
                Type = PipelineComponentType.Mutator,
                ImplementationType = typeof(ProjectCodeMutator),
                Order = 30,
                Description = "Keeps the project code in step with the customer; Update, Pre-Operation, Sync; filtering attributes: dvt_accountid; PreImage 'PreImage' with dvt_accountid; PostImage: none"
            };
            yield break;
        }
    }
}
