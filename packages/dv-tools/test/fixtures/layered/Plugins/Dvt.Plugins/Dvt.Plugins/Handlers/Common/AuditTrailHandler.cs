// Synthetic fixture: a handler that entry plug-ins of two tables run.
using Microsoft.Xrm.Sdk;
using Dvt.Plugins.PluginFramework.Abstractions;
using Dvt.Plugins.PluginFramework.Runtime.Base;

namespace Dvt.Plugins.Handlers.Common
{
    public class AuditTrailHandler : IEntityHandler
    {
        public void Handle(ILocalPluginContext context, Entity entity)
        {
            // logic left out of the fixture
        }
    }
}
