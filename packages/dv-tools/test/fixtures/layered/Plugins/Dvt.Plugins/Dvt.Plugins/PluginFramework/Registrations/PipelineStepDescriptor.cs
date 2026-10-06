// Synthetic fixture: one step of an entry plug-in's pipeline.
using System;

namespace Dvt.Plugins.PluginFramework.Registrations
{
    public class PipelineStepDescriptor
    {
        public PipelineComponentType Type { get; set; }
        public Type ImplementationType { get; set; }
        public int Order { get; set; }
        public string Description { get; set; }
    }
}
