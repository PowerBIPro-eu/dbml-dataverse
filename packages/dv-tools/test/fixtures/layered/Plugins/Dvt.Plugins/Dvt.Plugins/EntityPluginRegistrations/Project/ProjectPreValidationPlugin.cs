// Synthetic fixture: a Pre-Validation entry plug-in (stage 10, always synchronous).
using System.Collections.Generic;
using Dvt.Plugins.Model;
using Dvt.Plugins.PluginFramework.Registrations;
using Dvt.Plugins.PluginFramework.Runtime;
using Dvt.Plugins.Validators.Project;

namespace Dvt.Plugins.EntityPluginRegistrations.Project
{
    /// <summary>Entry point for Project Pre-Validation pipeline execution. PRT registration: Delete, Pre-Validation, Sync.</summary>
    public class ProjectPreValidationPlugin : PipelinePluginBase
    {
        public ProjectPreValidationPlugin() : base(typeof(ProjectPreValidationPlugin)) { }

        /// <summary>Dataverse table this plug-in runs on.</summary>
        public override string EntityLogicalName => dvt_project.EntityLogicalName;

        /// <summary>Delete, Pre-Validation, Sync; filtering attributes: none; PreImage 'PreImage' with ownerid; PostImage: none.</summary>
        public override IEnumerable<PipelineStepDescriptor> GetDeleteSteps()
        {
            yield return new PipelineStepDescriptor
            {
                Type = PipelineComponentType.Validator,
                ImplementationType = typeof(ProjectOwnerValidator),
                Order = 10,
                Description = "Only the project lead may delete a project; Delete, Pre-Validation, Sync; filtering attributes: none; PreImage 'PreImage' with ownerid; PostImage: none"
            };
        }
    }
}
