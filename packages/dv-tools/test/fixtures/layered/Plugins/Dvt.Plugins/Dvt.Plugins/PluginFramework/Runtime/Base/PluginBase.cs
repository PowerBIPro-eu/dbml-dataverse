// Synthetic fixture.
using System;
using Microsoft.Xrm.Sdk;

namespace Dvt.Plugins.PluginFramework.Runtime.Base
{
    public interface ILocalPluginContext { }

    public abstract class PluginBase : IPlugin
    {
        protected PluginBase(Type pluginType) { }

        public void Execute(IServiceProvider serviceProvider) { }
    }
}
