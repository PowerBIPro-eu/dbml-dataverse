// Synthetic fixture: the pipeline contract of a mutator.
using Microsoft.Xrm.Sdk;
using Dvt.Plugins.PluginFramework.Runtime.Base;

namespace Dvt.Plugins.PluginFramework.Abstractions
{
    public interface IEntityMutator
    {
        void Mutate(ILocalPluginContext context, Entity entity);
    }
}
