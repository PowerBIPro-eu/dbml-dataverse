// Synthetic fixture: the pipeline contract of a validator.
using Microsoft.Xrm.Sdk;
using Dvt.Plugins.PluginFramework.Runtime.Base;

namespace Dvt.Plugins.PluginFramework.Abstractions
{
    public interface IEntityValidator
    {
        void Validate(ILocalPluginContext context, Entity entity);
    }
}
