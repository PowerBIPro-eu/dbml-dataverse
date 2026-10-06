// Synthetic fixture: the Create steps depend on a condition, so that message's composition cannot be
// read from the code; the Update steps can.
using System.Collections.Generic;
using Dvt.Plugins.Model;
using Dvt.Plugins.PluginFramework.Registrations;
using Dvt.Plugins.PluginFramework.Runtime;
using Dvt.Plugins.Validators.Meeting;

namespace Dvt.Plugins.EntityPluginRegistrations.Meeting
{
    public class MeetingPreOperationPlugin : PipelinePluginBase
    {
        private static readonly bool CheckDates = true;

        public MeetingPreOperationPlugin() : base(typeof(MeetingPreOperationPlugin)) { }

        /// <summary>Dataverse table this plug-in runs on.</summary>
        public override string EntityLogicalName => dvt_meeting.EntityLogicalName;

        /// <summary>
        /// Create, Pre-Operation, Sync; filtering attributes: none; PreImage: none; PostImage: none.
        /// The step depends on a condition on purpose: dv-tools cannot read this message's composition.
        /// </summary>
        public override IEnumerable<PipelineStepDescriptor> GetCreateSteps()
        {
            if (CheckDates)
            {
                yield return new PipelineStepDescriptor
                {
                    Type = PipelineComponentType.Validator,
                    ImplementationType = typeof(MeetingDateValidator),
                    Order = 10,
                    Description = "Rejects a meeting that ends before it starts; Create, Pre-Operation, Sync; filtering attributes: none; PreImage: none; PostImage: none"
                };
            }
        }

        /// <summary>
        /// Update, Pre-Operation, Sync; filtering attributes: scheduledstart,scheduledend;
        /// PreImage 'PreImage' with scheduledstart,scheduledend; PostImage: none.
        /// </summary>
        public override IEnumerable<PipelineStepDescriptor> GetUpdateSteps()
        {
            yield return new PipelineStepDescriptor
            {
                Type = PipelineComponentType.Validator,
                ImplementationType = typeof(MeetingDateValidator),
                Order = 10,
                Description = "Rejects a meeting that ends before it starts; Update, Pre-Operation, Sync; filtering attributes: scheduledstart,scheduledend; PreImage 'PreImage' with scheduledstart,scheduledend; PostImage: none"
            };
        }
    }
}
