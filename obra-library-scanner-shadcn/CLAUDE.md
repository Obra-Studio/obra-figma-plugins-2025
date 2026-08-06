# Obra Remote Library Scanner (Shadcn kit specific)

A fork of `../obra-library-scanner`, rebuilt from first principles for the **9 Obra shadcn/ui kit
files**. The generic scanner has to guess what a name means. This one knows.

Source of truth for the kit itself: `~/Sites/obra-shadcn-ui-kit/figma/CLAUDE.md`. Read it before
changing anything in the kit model below — the rules here are derived from it and go stale with it.

## Why a fork exists

The generic scanner treats every remote reference as a name-matching problem and, when a name is
ambiguous, correctly refuses to guess. In this kit most of those "ambiguous" cases are not ambiguous
at all — they follow published structural rules. Encoding the rules turns *needs review* into
*deterministic*, which is the difference between a tool you supervise and a tool you run.

Measured on the Community file (2026-07-29, recorded in the kit doc): **2,392 remote instances; 765
rebindable, 1,627 not.** Of the unfixable bulk, **1,586 are `Lucide␣␣/ …` icons** that have no local
counterpart at all. The generic scanner reports those the same way it reports a typo. They are not a
typo — they are a missing icon set, and no matcher can fix them.

## The three rules that do the work

### 1. Style-suffix rewriting

Style-ified components are named `<Component> - <Style>` — `Button - Nova`, `Select & Combobox -
Luma`. There are 8 Pro styles: **Nova, Luma, Vega, Rhea, Sera, Lyra, Mira, Maia**.

A reference to `Button - Nova` inside the **Luma** file is drift: the local equivalent is `Button -
Luma`. Generic similarity scores that pair at ≈0.69 — below any safe fuzzy threshold — so the generic
scanner finds nothing. The rule makes it exact.

### 2. Lucide icon naming

Two remote icon schemes coexist and behave completely differently:

| Remote name | Local counterpart | Outcome |
| --- | --- | --- |
| `Lucide / x` (single space) | `Icon / x` | rebinds — 576 × `Lucide / square-dashed` alone |
| `Lucide␣␣/ x` (**double** space) | none | **cannot** rebind — the full Lucide set is not in the file |

This is why Figma's own *Swap Library* fails on these files: there is no local target. Reporting them
as "no local match" invites the user to hunt for a match that does not exist. They need naming as
what they are: **the unused Lucide set is absent from this file**, 1,586 references waiting on an
import, not on a matcher.

### 3. Library identity

Each of the 9 files **publishes its own library and subscribes to itself**, so a reference can be
remote and still be "this file". The library keys are in the kit doc. Classification matters:

- **self** — this file's own published library. Common; still a release blocker per the kit rules.
- **sibling style** — another of the 8 Pro styles. Real drift; 1.13.1 records exactly this bug
  ("Collapsible: components from Vega were used accidentally" in Luma & Rhea).
- **Daphne** — a 10th library carrying the same version string and the same components. Looks like a
  legitimate hit and is out of scope.
- **client fork** — `AI Digital Elevate UI Library - Nova`, `Obra shadcn/ui kit (1.5.0) (LaluCARE)`.
- **unknown** — genuinely foreign.

`figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()` gives real `libraryName` values for
**variable collections only**. Components and styles expose no library name, so those fall back to
the naming rules above.

## The kit's own rule, which sets the bar

> Any variable, component or style referencing another library is strictly forbidden in these files.
> Each file must be self-contained — this is what makes 9 forks safe. A remote reference is a release
> blocker, not a nit.

So the top-level answer is **binary per file**: self-contained, or not. "Down to 60 references" is not
a result. The UI leads with pass/fail and the shortest path to pass.

## Naming vocabulary

| Marker | Meaning |
| --- | --- |
| `(OC)` | **Obra Custom** — not part of shadcn/ui. Holds variants that would otherwise pollute an official component, so Button/Input/Label stay 1:1 with shadcn. |
| `•` (trailing) | **Style-ified** — this component genuinely differs between the 8 styles. A factual claim, not decoration. |
| `.` prefix | **Never published** — slot content and internal helpers (`.Component Page Header`, `.Component Page Footer`, `.Slot Default Placeholder`). |
| `📖 …`, `---` | Divider pages. Pages sort alphabetically *within* divider-delimited blocks, ignoring the trailing `•` and leading emoji. |

## Expected structure

A component page is one doc frame named `<Component> - <Style>`, laid out vertically:

1. `.Component Page Header` — instance, FILL width / HUG height.
2. `Content` — the component, variants, examples.
3. `.Component Page Footer` — instance, **last child**, FILL width, HUG height. The main lives on
   `Internal Components`. **Four pages must NOT have one: `Colors`, `Typography`, `Icons`, `Shadows`.**

Community must contain every Nova component **except** the five chat primitives — `Attachment`,
`Bubble`, `Marker`, `Message`, `Message Scroller`. Anchor that filter at the **start** of the name:
`Todo Marker (OC)` is not the chat `Marker`.

## What the rebuild keeps, and what it changes

**Keep** (these work):
- The page tree with cached per-page counts.
- Per-character-range fixing. `setRangeBoundVariable(start, end, field, variable|null)` and
  `setRangeFills(start, end, paints)`. Query **one field per `getStyledTextSegments` call** — asking
  for several splits the text wherever *any* of them changes and shreds one binding into fragments.

**Change** (these do not):
- **Fixing a root component from another page.** Do not scan that component's whole page to reach it.
  `getNodeByIdAsync` resolves nodes on other pages without switching pages — walk the component's own
  subtree directly.
- **Missing components.** Report them against the expected set, not as an absence of findings.

## Hard-won Figma API facts

Re-deriving these cost most of the previous build. Do not rediscover them.

| Fact | Consequence |
| --- | --- |
| `setBoundVariableAsync` **does not exist** | use `node.setBoundVariable(field, variable \| null)` |
| Applying a text style or a text-field variable **requires the font loaded** | load the node's current fonts (per segment when mixed) *and* the incoming style's font first |
| `node.boundVariables[textField]` is an **array with the ranges stripped out** | read per-range bindings from `getStyledTextSegments(['boundVariables'])` |
| `GradientPaint` has no `boundVariables` | the binding is on each `ColorStop`, and there is **no setter** — gradients stay manual |
| `NodeChangeProperty` really spells it **`stokeTopWeight`** | list both spellings when filtering overridden fields |
| A variant's `name` is its property string (`Size=Large, State=Hover`) | identity is the **component set's** name, on `parent.name` |
| A healthy **remote** main reports `parent === null` | `parent === null && !remote` is the orphan test, not `parent === null` |
| `ComponentNode.instances` throws under `documentAccess: dynamic-page` | use `getInstancesAsync()` |
| `findAllWithCriteria` descends **into** instance sublayers, returning transient composite ids | manual-walk and do not recurse into `INSTANCE` |
| `figma.skipInvisibleInstanceChildren = true` is worth several × on traversal | hidden instance children become unreachable — acceptable, they come from the main |
| Two ranges bound to the same variable on the same field | the reference id must include `start`/`end`, or one silently overwrites the other |

## Architecture

Single-file vanilla JS, no build step, matching the house convention. `code.js` is sectioned:

1. **Kit model** — the rules above, pure and testable. No Figma API calls.
2. **Scan engine** — synchronous collect → dedupe → chunked async resolve. Generation-token
   cancellation, never a sticky boolean.
3. **Matcher** — kit rules first, then the generic tiers (exact → normalised → prefix-stripped →
   page-name → tail → fuzzy with a scale-sibling veto).
4. **Fix engine** — components before styles before variables; main components before instances.
5. **Report model** — component-first, then pages, then loose layers.
6. **JSON export** (added 2026-07-30) — `buildJsonReport()`/`handleExportJsonReport()`, wired to the
   `export-json-report` message and the topbar "Export JSON" button. Pulls every scanned page's full
   report out of the in-memory `pageReports` map (not the persisted index, which only holds counts) and
   downloads one combined JSON file via a Blob + `<a download>` in `ui.html`. Each group already carries
   `blockedReason` in plain English when it can't be auto-applied, and `match` when it can — this is
   meant to be handed to Claude as a ready-made todo list, not re-derived from scratch. Scan first
   (Scan file / Scan all); exporting before any page has been scanned just notifies and does nothing.

Tests live in `tests/` and run under plain `node`. The kit model is pure, so it is fully testable
without Figma; extract-and-run is how the generic scanner's matcher bugs were caught.

## Status

**Stale note, corrected 2026-07-30**: this used to say the scan engine, matcher and UI still needed
porting from `../obra-library-scanner`. That's no longer true — `code.js` is 4,196 lines and has a full
pipeline: reference collection (styles/variables/text-range/node refs), chunked async resolution with
generation-token cancellation, a local index, kit-rules-first matching with the generic fallback tiers
(exact → normalised → prefix-stripped → page-name → tail → fuzzy with a scale-sibling veto), variant
resolution, confidence thresholds, override-binding snapshot/restore across swaps, and full
scan/plan/apply/remap/audit handlers (`handleScanAll`, `handlePlanFixes`, `handleApplyFixes`,
`handleFixRef`, `handleRemapRef`, `handleKitAudit`, `handleComponentImpact`). `ui.html` is 3,005 lines,
not a stub. Confirmed live in Figma by the user (2026-07-30): "the new one seems to work fine too."

Kit model: implemented and tested (pure, runs under plain `node`, see `tests/kit-model.test.js`).
Scan/matcher/apply pipeline: implemented, confirmed working live, **not covered by the automated
tests** — only the pure kit-model functions are. **This is now the primary tool for remote-reference
scanning on this kit** — prefer it over the generic `../obra-library-scanner` (which lacks the
kit-specific deterministic rules and leans on the fuzzy tier more often) going forward.
