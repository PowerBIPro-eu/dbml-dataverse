// Synthetic fixture: an early-bound class, as the model generator writes it.
using Microsoft.Xrm.Sdk;

namespace Dvt.Plugins.Model
{
    [Microsoft.Xrm.Sdk.Client.EntityLogicalName("dvt_meeting")]
    public partial class dvt_meeting : Entity
    {
        public const string EntityLogicalName = "dvt_meeting";

        public dvt_meeting() : base(EntityLogicalName) { }
    }
}
