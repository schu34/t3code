# Harness implementation checklist

## Foundation

- [x] Pin the local fork to the selected T3 Code upstream revision.
- [x] Give the fork its own Harness desktop identity, state paths, and update behavior.
- [x] Preserve the upstream MIT license and provider/chat internals.

## Agent canvas

- [x] Add durable graph contracts, SQLite migration, revisioning, and RPC authorization.
- [x] Render a 2D canvas with live nodes, project grouping, saved positions, collapse controls, and edge labels.
- [x] Show execution status and delivery status independently on each node.
- [x] Open each node into the existing persistent full chat surface.
- [x] Create child agents and side-chat nodes from the canvas.
- [x] Drag or select connections between agents and persist the relationship.

## Coordination

- [x] Persist coordination channels, revisions, decisions, messages, and outbox/inbox deliveries.
- [x] Add bounded three-round convergence and explicit syncing/aligned/needs-attention/paused states.
- [x] Add live graph subscriptions and a channel composer for durable user updates.
- [x] Make multi-row message and acknowledgement writes transactional.

## Verification

- [x] Run focused contract, migration, canvas, desktop, format, lint, and type checks.
- [x] Document the architecture and local usage in the README.
- [ ] Add provider-specific transcript fork adapters and automatic delivery workers in the next slice.
- [x] Add a full channel-detail query to hydrate the canvas transcript panel.

## Canvas render-loop debugging checklist

- [x] Reproduce the fresh-onboarding crash and capture the React Flow `StoreUpdater` stack.
- [x] Audit controlled canvas props for render-time array construction.
- [x] Audit external-store selectors for derived arrays that change identity on unrelated updates.
- [x] Memoize the selected-node projection and draft summaries at their source boundaries.
- [x] Preserve React Flow measurements when graph snapshot synchronization rebuilds node data.
- [x] Keep newly laid-out agents distinct and below the canvas controls; reduce narrow-screen chrome.
- [x] Keep authenticated home on the canvas and add a sidebar return action.
- [x] Run the focused canvas tests and web type check.
- [x] Re-run the isolated browser smoke test after the render-stability patch.

## Canvas visual cleanup

- [x] Tighten agent cards while keeping both status badges readable.
- [x] Place fresh delegation children in a centered row below their parent.
- [x] Route delegation edges from the parent bottom handle to the child top handle.
- [x] Preserve saved canvas positions and cover hierarchy placement with focused tests.
