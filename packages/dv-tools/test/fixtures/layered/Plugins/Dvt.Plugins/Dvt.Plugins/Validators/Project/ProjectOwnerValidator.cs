// Synthetic fixture: a validator.
using Microsoft.Xrm.Sdk;
using Dvt.Plugins.PluginFramework.Abstractions;
using Dvt.Plugins.PluginFramework.Runtime.Base;

namespace Dvt.Plugins.Validators.Project
{
    public class ProjectOwnerValidator : IEntityValidator
    {
        public void Validate(ILocalPluginContext context, Entity entity)
        {
            // logic left out of the fixture
        }
    }
}
