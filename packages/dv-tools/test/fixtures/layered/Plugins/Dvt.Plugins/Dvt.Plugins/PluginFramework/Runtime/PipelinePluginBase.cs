// Synthetic fixture: the pipeline engine is left out; dv-tools reads only the declarations.
using System;
using Dvt.Plugins.PluginFramework.Registrations;

namespace Dvt.Plugins.PluginFramework.Runtime
{
    public abstract class PipelinePluginBase : EntityPluginRegistration
    {
        protected PipelinePluginBase(Type pluginType) : base(pluginType) { }

        protected virtual PipelineExecutionMode ExecutionMode => PipelineExecutionMode.Sync;
    }
}
