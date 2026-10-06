// Synthetic fixture: an intermediate base class between PipelinePluginBase and an entry plug-in.
using System;

namespace Dvt.Plugins.PluginFramework.Runtime
{
    public abstract class AuditedPipelinePluginBase : PipelinePluginBase
    {
        protected AuditedPipelinePluginBase(Type pluginType) : base(pluginType) { }
    }
}
