// Synthetic fixture: a handler.
using Microsoft.Xrm.Sdk;
using Dvt.Plugins.PluginFramework.Abstractions;
using Dvt.Plugins.PluginFramework.Runtime.Base;

namespace Dvt.Plugins.Handlers.Project.Async
{
    public class ProjectNotificationHandler : IEntityHandler
    {
        public void Handle(ILocalPluginContext context, Entity entity)
        {
            // logic left out of the fixture
        }
    }
}
