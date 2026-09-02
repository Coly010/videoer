# ADR 063: Explicit construction-material history participation

- Status: accepted
- Date: 2026-09-02

## Context

Surface-history v3 correctly carried traffic, exposure, routed runoff and conserved dirt through every active paving cell, but the rendering contract was incomplete. A receiver could contain responsive modeled units alongside joints or borders with no optical history response. TypeScript verification passed when the receiver and field matched, and Blender reported those materials as unmapped while continuing because at least one other material responded. The audit therefore proved field causality without proving that every active construction domain consumed it.

The existing paving architecture already distinguishes modeled units, continuous joint, continuous substrate and border targets, while each field cell carries its construction target class. Adding another role map to the history sidecar would duplicate those sources of truth and make a profile responsible for renderer behavior that belongs to materials.

## Decision

`SurfaceMaterial` owns an optional, typed `surfaceHistoryV3Participation` declaration:

- `optical-response` requires both `historyResponseV3` and `dirtMassResponse`;
- `transport-only` requires a non-empty rationale and forbids both optical response contracts.

The declaration remains optional in the material schema so legacy v1/v2 assets can still load. It is mandatory for every material referenced by an active v3 field cell. TypeScript cinematic verification and Blender independently enforce exact active-material coverage and report optical and transport-only sets by construction target class. Inactive geometry material slots do not count.

Project-owned paving units, granular joint/substrate materials and typed paving-border materials declare optical participation. Border materials state compatible kerb, gutter or soldier-course kinds. The existing atomic paving-construction binder accepts exact border-target bindings and validates them against the existing paving definition; it does not introduce a second binder or role taxonomy.

## Consequences

- An active joint, substrate or border can no longer carry causal field state while silently rendering unchanged.
- Hydrology-only participation remains possible, but only as an explicit, reviewable material decision.
- Old materials remain readable, while any attempt to use an undeclared old material in a v3 render fails closed.
- Border assets become reusable inventory with the same water, history, dirt, provenance and construction-binding contracts as paving units and granular fills.
- History profiles remain renderer-neutral and do not encode material participation modes.
- Future domain-specific geometry or normal responses can evolve inside the material families without changing the conserved field topology.

## Verification

- material-schema probes reject incomplete optical declarations, response-bearing transport-only declarations and empty rationales;
- paving assembly rejects missing, extra and wrong-kind border bindings without replacing prior output;
- cinematic verification rejects any active undeclared material and reports optical/transport-only participation by target class;
- native Blender rejects incomplete participation, binds every optical slot and skips only explicitly declared transport-only slots;
- unrelated historic and contemporary hosts must pass exact active-material coverage before their visual audit can continue.
