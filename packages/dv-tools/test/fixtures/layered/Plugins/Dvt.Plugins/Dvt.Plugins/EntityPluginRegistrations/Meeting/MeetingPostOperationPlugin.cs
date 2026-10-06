// Synthetic fixture: a Post-Operation entry plug-in whose name and code do not say sync or async.
using System.Collections.Generic;
using Dvt.Plugins.Handlers.Common;
using Dvt.Plugins.Model;
using Dvt.Plugins.PluginFramework.Registrations;
using Dvt.Plugins.PluginFramework.Runtime;

namespace Dvt.Plugins.EntityPluginRegistrations.Meeting
{
    /// <summary>Entry point for Meeting Post-Operation pipeline execution. PRT registration: Create, Post-Operation.</summary>
    public class MeetingPostOperationPlugin : PipelinePluginBase
    {
        public MeetingPostOperationPlugin() : base(typeof(MeetingPostOperationPlugin)) { }

        /// <summary>Dataverse table this plug-in runs on.</summary>
        public override string EntityLogicalName => dvt_meeting.EntityLogicalName;

        /// <summary>Create, Post-Operation; filtering attributes: none; PreImage: none; PostImage: none.</summary>
        public override IEnumerable<PipelineStepDescriptor> GetCreateSteps()
        {
            yield return new PipelineStepDescriptor
            {
                Type = PipelineComponentType.Handler,
                ImplementationType = typeof(AuditTrailHandler),
                Order = 10,
                Description = "Writes an audit trail entry; Create, Post-Operation; filtering attributes: none; PreImage: none; PostImage: none"
            };
        }
    }
}
