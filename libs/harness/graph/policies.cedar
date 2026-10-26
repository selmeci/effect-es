// Omnigraph Cedar Authorization Policies
//
// 1. Permit agent-mcp to read data on main and plan/* branches
permit (
    principal == Omnigraph::Subject::"agent-mcp",
    action == Omnigraph::Action::"read",
    resource
)
when {
    resource.branch == "main" || resource.branch like "plan/*"
};

// 2. Forbid agent-mcp from mutating branches or loading graph entities directly
forbid (
    principal == Omnigraph::Subject::"agent-mcp",
    action in [
        Omnigraph::Action::"change",
        Omnigraph::Action::"branch_create",
        Omnigraph::Action::"branch_merge",
        Omnigraph::Action::"branch_delete"
    ],
    resource
);

// 3. Permit harness-cli full administrative access to branches and graph mutations
permit (
    principal == Omnigraph::Subject::"harness-cli",
    action in [
        Omnigraph::Action::"read",
        Omnigraph::Action::"change",
        Omnigraph::Action::"branch_create",
        Omnigraph::Action::"branch_merge",
        Omnigraph::Action::"branch_delete"
    ],
    resource
);
