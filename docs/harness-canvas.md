# Agent canvas

The landing page shows project threads and supported provider-native children as a graph.
Select a thread-backed agent to open its chat, or a native child to inspect its live
transcript in the parent thread's Agents panel. Native children are inspect-only.

Use Roles to author reusable instructions for this environment and assign a role to any
thread-backed agent. A role's instructions are added to every turn that agent runs.

Agents created from the canvas each get their own git worktree. A child agent branches
from its lead's branch, so the lead can merge its delegates' work and resolve conflicts.

Connect two agents to let them talk. An agent can message its lead, its delegates, and
anything connected to it in either direction; a message starts a turn in the
recipient's thread, where it appears tagged with the sender.

Dragging and collapsing nodes affects only the current canvas session. Roles, creation
links, and connections survive reconnects; canvas positions do not.
