// Synthetic fixture: the step methods an entry plug-in overrides.
using System;
using System.Collections.Generic;
using System.Linq;
using Dvt.Plugins.PluginFramework.Runtime.Base;

namespace Dvt.Plugins.PluginFramework.Registrations
{
    public abstract class EntityPluginRegistration : PluginBase
    {
        protected EntityPluginRegistration(Type pluginType) : base(pluginType) { }

        public abstract string EntityLogicalName { get; }

        public virtual IEnumerable<PipelineStepDescriptor> GetCreateSteps() => Enumerable.Empty<PipelineStepDescriptor>();
        public virtual IEnumerable<PipelineStepDescriptor> GetUpdateSteps() => Enumerable.Empty<PipelineStepDescriptor>();
        public virtual IEnumerable<PipelineStepDescriptor> GetDeleteSteps() => Enumerable.Empty<PipelineStepDescriptor>();
        public virtual IEnumerable<PipelineStepDescriptor> GetSpecialSteps() => Enumerable.Empty<PipelineStepDescriptor>();
    }
}
