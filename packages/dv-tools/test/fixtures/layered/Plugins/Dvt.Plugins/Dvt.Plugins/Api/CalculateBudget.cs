// Synthetic fixture: the implementation of the Custom API dvt_CalculateBudget, which is not a pipeline entry plug-in.
using System;
using Dvt.Plugins.PluginFramework.Runtime.Base;

namespace Dvt.Plugins.Api
{
    public class CalculateBudget : PluginBase
    {
        public CalculateBudget() : base(typeof(CalculateBudget)) { }
    }
}
