# Meterless H-MEM reference runtime

Vendored unmodified from [Meterless/Meterless](https://github.com/Meterless/Meterless/tree/1742dec56a66e58eef9dda2d2b865823758ca8cd/engines/hmem/reference/src), revision `1742dec56a66e58eef9dda2d2b865823758ca8cd`, retrieved 2026-10-27. Apache-2.0; full license in LICENSE.

Used in the Thesis application for risk-preference recall with provenance, correction supersession, feedback and a trust ledger. Filesystem persistence is disabled in the Worker; the caller supplies user-scoped records from D1 and persists snapshots. This is the official minimal reference implementation, not a claim that every H-MEM feature is exposed in the product.

Adaptation: relative TypeScript imports omit the `.ts` extension to match the host Vite/TypeScript project. No engine algorithm was changed.

The official `engines/hmem/conformance/runner.ts` and its vectors are also vendored from the same pinned revision under `conformance/`; they passed 13/13 checks on 2026-10-27.
