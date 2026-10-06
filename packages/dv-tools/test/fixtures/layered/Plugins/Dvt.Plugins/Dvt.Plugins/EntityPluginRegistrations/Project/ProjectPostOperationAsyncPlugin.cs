// Synthetic fixture: an asynchronous entry plug-in that returns its Update steps as one array. Two of
// them have the same Order (they run by full type name), and the audit handler is shared with Invoice.
using System.Collections.Generic;
using Dvt.Plugins.Handlers.Common;
using Dvt.Plugins.Handlers.Project.Async;
using Dvt.Plugins.Model;
using Dvt.Plugins.PluginFramework.Registrations;
using Dvt.Plugins.PluginFramework.Runtime;

namespace Dvt.Plugins.EntityPluginRegistrations.Project
{
    /// <summary>
    /// Entry point for Project Post-Operation asynchronous pipeline execution.
    /// PRT registration: Update, Assign, Post-Operation, Async; filtering attributes: dvt_isactive;
    /// requires PreImage 'PreImage' with dvt_isactive; no PostImage.
    /// </summary>
    public class ProjectPostOperationAsyncPlugin : PipelinePluginBase
    {
        public ProjectPostOperationAsyncPlugin() : base(typeof(ProjectPostOperationAsyncPlugin)) { }

        public override string EntityLogicalName => dvt_project.EntityLogicalName;

        protected override PipelineExecutionMode ExecutionMode => PipelineExecutionMode.Async;

        /// <summary>Update, Post-Operation, Async; filtering attributes: dvt_isactive; PreImage 'PreImage' with dvt_isactive; PostImage: none.</summary>
        public override IEnumerable<PipelineStepDescriptor> GetUpdateSteps() => new[]
        {
            new PipelineStepDescriptor
            {
                Type = PipelineComponentType.Handler,
                ImplementationType = typeof(ProjectNotificationHandler),
                Order = 10,
                Description = @"Tells the owner that the project was stopped; Update, Post-Operation, Async; filtering attributes: dvt_isactive; PreImage 'PreImage' with dvt_isactive; PostImage: none"
            },
            new PipelineStepDescriptor
            {
                Type = PipelineComponentType.Handler,
                ImplementationType = typeof(AuditTrailHandler),
                Order = 10,
                Description = "Writes an audit trail entry; Update, Post-Operation, Async; filtering attributes: none; PreImage: none; PostImage: none"
            },
        };

        /// <summary>Every other message (Assign), Post-Operation, Async; PreImage: none; PostImage: none.</summary>
        public override IEnumerable<PipelineStepDescriptor> GetSpecialSteps()
        {
            yield return new PipelineStepDescriptor
            {
                Type = PipelineComponentType.Handler,
                ImplementationType = typeof(AuditTrailHandler),
                Order = 10,
                Description = "Writes an audit trail entry when the project is assigned; Assign, Post-Operation, Async; PreImage: none; PostImage: none"
            };
        }
    }
}
