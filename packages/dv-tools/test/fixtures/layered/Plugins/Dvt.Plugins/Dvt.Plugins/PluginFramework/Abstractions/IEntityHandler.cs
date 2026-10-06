// Synthetic fixture: the pipeline contract of a handler.
using Microsoft.Xrm.Sdk;
using Dvt.Plugins.PluginFramework.Runtime.Base;

namespace Dvt.Plugins.PluginFramework.Abstractions
{
    public interface IEntityHandler
    {
        void Handle(ILocalPluginContext context, Entity entity);
    }
}
