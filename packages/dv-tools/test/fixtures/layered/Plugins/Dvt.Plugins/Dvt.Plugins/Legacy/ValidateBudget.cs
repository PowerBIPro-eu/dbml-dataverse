// Synthetic fixture: a registered plug-in from before the pipeline architecture, with its logic inline.
using System;
using Dvt.Plugins.PluginFramework.Runtime.Base;

namespace Dvt.Plugins.Project
{
    public class ValidateBudget : PluginBase
    {
        public ValidateBudget() : base(typeof(ValidateBudget)) { }
    }
}
