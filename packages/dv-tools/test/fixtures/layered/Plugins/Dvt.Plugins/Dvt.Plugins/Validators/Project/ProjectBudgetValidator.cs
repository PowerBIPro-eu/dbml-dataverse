// Synthetic fixture: a validator that sees only the changed columns.
using Microsoft.Xrm.Sdk;
using Dvt.Plugins.PluginFramework.Abstractions;
using Dvt.Plugins.PluginFramework.Capabilities;
using Dvt.Plugins.PluginFramework.Runtime.Base;

namespace Dvt.Plugins.Validators.Project
{
    public class ProjectBudgetValidator : IEntityValidator, IRequiresOriginalTarget
    {
        public void Validate(ILocalPluginContext context, Entity entity)
        {
            // logic left out of the fixture
        }
    }
}
