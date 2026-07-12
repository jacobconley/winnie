Run the agent completely independent of the editor.
That means that the agent does not have LSP, but reportedly, that's less of a gap than context retrieval using the editor's indexing, which can be mitigated with good architecture and documentation and prompt scoping.  
This lets us have more explicit control over the agents, **most importantly directory context**, which is one of the main themes here - we will be transferring agents between working trees

 - Use a `WebviewView` not a `WebviewPanel` - we want to keep the secondary sidebar UX pattern established by Cursor
 - No review/accept workflow like default cursor, no diffs - rely on Git

# Cursor agent integration

There's a `stream-json` output option.
We give up interactive tool approvals with this mode, but it gives us streaming, which I think is more important; the user can keep an eye on the agents and stop them if anything goes awry, which is how most work gets done with the state of models nowadays.  The streaming includes tool calls and "assistant events", but not thinking.

Another option is ACP, which will potentially give us back thinking and interacting, at the cost of a bigger integration surface and probably more churn. 