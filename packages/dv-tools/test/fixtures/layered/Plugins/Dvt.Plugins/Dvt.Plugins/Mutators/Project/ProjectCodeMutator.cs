// Synthetic fixture: a mutator.
using Microsoft.Xrm.Sdk;
using Dvt.Plugins.PluginFramework.Abstractions;
using Dvt.Plugins.PluginFramework.Runtime.Base;

namespace Dvt.Plugins.Mutators.Project
{
    public class ProjectCodeMutator : IEntityMutator
    {
        public void Mutate(ILocalPluginContext context, Entity entity)
        {
            // logic left out of the fixture
        }
    }
}
