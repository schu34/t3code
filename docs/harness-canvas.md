# Agent canvas

The landing page shows project threads and supported provider-native children as a graph.
Select a thread-backed agent to open its chat, or a native child to inspect its live
transcript in the parent thread's Agents panel. Native children are inspect-only.

Use Roles & relationships to author reusable instructions for this environment and
assign roles to thread-backed agents. A role applies to that thread's turns. Choose
a relationship explicitly when connecting agents; its request and response instructions
belong to that interaction, not every ordinary turn of either agent.

Select a connection to view its ordered channel transcript and record coordination
messages. Channels currently record messages; they do not automatically start agent
turns or deliver provider replies. Provider-owned child transcripts remain separate.

Dragging and collapsing nodes affects only the current canvas session. Relationships,
roles, and channel history survive reconnects; canvas positions do not.
