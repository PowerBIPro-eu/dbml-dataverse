// Synthetic fixture: the legacy engine's GetRegistration() indirection: the table and the steps are in a
// nested registration class, so dv-tools reports this entry plug-in as unknown.
using System.Collections.Generic;
using Dvt.Plugins.Model;
using Dvt.Plugins.PluginFramework.Registrations;
using Dvt.Plugins.PluginFramework.Runtime;
using Dvt.Plugins.Validators.Meeting;

namespace Dvt.Plugins.EntityPluginRegistrations.Meeting
{
    /// <summary>Entry point for Meeting Pre-Validation pipeline execution (legacy layout). PRT registration: Create, Pre-Validation, Sync.</summary>
    public class MeetingPreValidationPlugin : PipelinePluginBase
    {
        private static readonly EntityPluginRegistration Steps = new Registration();

        public MeetingPreValidationPlugin() : base(typeof(MeetingPreValidationPlugin)) { }

        /// <summary>Returns the separate registration object of the legacy engine.</summary>
        protected EntityPluginRegistration GetRegistration() => Steps;

        /// <summary>The legacy registration: table and steps.</summary>
        private class Registration : EntityPluginRegistration
        {
            public Registration() : base(typeof(Registration)) { }

            /// <summary>Dataverse table this plug-in runs on.</summary>
            public override string EntityLogicalName => dvt_meeting.EntityLogicalName;

            /// <summary>Create, Pre-Validation, Sync; filtering attributes: none; PreImage: none; PostImage: none.</summary>
            public override IEnumerable<PipelineStepDescriptor> GetCreateSteps()
            {
                yield return new PipelineStepDescriptor
                {
                    Type = PipelineComponentType.Validator,
                    ImplementationType = typeof(MeetingDateValidator),
                    Order = 10,
                    Description = "Rejects a meeting that ends before it starts; Create, Pre-Validation, Sync; filtering attributes: none; PreImage: none; PostImage: none"
                };
            }
        }
    }
}
