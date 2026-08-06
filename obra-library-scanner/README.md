# Obra Remote Library Scanner

Finds every reference to a remote (published library) resource in a Figma file and rebinds it to a
local equivalent, so the file can be detached from its libraries without breaking the local component
structure.

It detects remote **component instances**, **paint / text / effect / grid styles**, and **bound
variables** — including the ones that are easy to miss: variables bound to typography fields, to
effects, to layout grids and to component properties; styles applied to a character range inside a
mixed-style text node; and local variables or styles that quietly *alias* a remote one.

## Fix components first

A remote reference inside a **main component** is inherited by every instance of it. Fixing the main
is one edit that reaches all of them; fixing the instances is wasted effort, and for inherited content
it is not even possible — an instance cannot rebind what it inherits, only what it overrides.

So the useful question is not "which page has the most references" but **"which main components carry
them, and how heavily are those used"**. The *Components first* view answers that: every reference is
tagged at scan time with the main component whose subtree it lives in, then each of those mains is
weighed by `references × instances` — its usage counted across the whole document via
`getInstancesAsync`, not just its own page.

That ordering routinely inverts the page view. A component with three references used by two hundred
instances outranks one with fifty references and no usage at all. Both are worth fixing; only one of
them is upstream of six hundred inherited references.

Content inside a variant is attributed to its **component set**, since the set is what instances point
at. Layers outside any component are listed separately — they have no downstream reach and are fixed
page by page.

The list is only as complete as the scan behind it: a component's references live on its own page, so
the view says how many pages it is drawing on and warns when some are unscanned.

### Where a reference came from

The same logic applies to references found *on* an instance. Each one records the instance it arrived
through and that instance's main, so a group can say **"all 2 of these come from the main component
Drawer (Slots) - Nova on page Drawer"** and offer **Fix in Drawer (Slots) - Nova** directly. That
handler scans the main's page first if this session has not seen it, then fixes everything inside the
component.

Without it the plugin quietly invites the wrong repair: fixing the binding on the instance creates an
override that leaves the main broken and every other instance untouched. Nested instances report the
**outermost** one, because that is where the fix lands.

When the main is itself a library component it cannot be edited at all — the row says so and points
at swapping the instance to a local component instead, which is the only real fix.

## Using it

The plugin opens on the current page and scans it immediately, so there is something to look at
within a second or two.

- **Sidebar** — every page with its remote-reference count. Counts are cached on the document, so
  they are there the moment you reopen the plugin. A dot next to a count means the page has been
  edited since it was scanned.
- **Selecting several pages** — shift-click for a range, ⌘/Ctrl-click to add or drop one. The detail
  pane then shows the totals across the selection with **Scan N unscanned** and **Review & fix N
  across M pages**. A shift-range spans what is *visible*, so it does the expected thing while
  "remote only" is on. Right-clicking inside a selection acts on all of it.
- **Scan file** — walks every page that is not ignored. Running it a *second time in the same
  session* is nearly instant, because a page is skipped only when all of these hold: it was scanned
  since the plugin opened, no edit has been observed since, and the *Instance depth* setting has not
  changed. *Settings ▸ Rescan every page* forces everything regardless.

  Freshness is deliberately claimed only for the current session. Staleness is detected by a
  `nodechange` watcher, and that watcher only exists for pages this session loaded — so an edit made
  before the plugin opened, by a teammate, or on a page you never visited is invisible to it. The
  stored index also travels with the file (it lives on `figma.root`), so opening a document someone
  else scanned would otherwise inherit their verdict. A count restored from the document is shown as
  such and never suppresses a scan.
- **Fix N of M** — the button says how many of the page's references the current threshold would
  actually apply, not how many exist. Pressing it opens a review sheet: what will be applied, what
  needs your confirmation, and what cannot be fixed here. Nothing is written until you press Apply. A
  multi-page selection uses the same sheet, planned across every selected page at once.
- **Fix N exact** — the conservative pass. Only references whose name matches a local one *identically*
  are rebound; nothing is inferred. This is the one worth running unattended.
- **Fix N variables / styles / components** — the same pass, one kind at a time. Component swaps are
  the operations that restructure a file, so taking the variables and leaving the components for a
  separate look is a different appetite for risk, not just a filter. Each button is a strict slice of
  **Fix N of M** and the three add up to it exactly, so running all three equals running the main one.
  They only appear when a page has more than one kind, since otherwise the main button already says
  the same thing.
- **Picking groups** — every actionable group has a checkbox. Tick a few (shift-click for a range, or
  *Select all actionable groups*) and a bar appears with **Fix N** and **Unbind N**, counted
  separately so a mixed selection can do both. Each group applies the target shown next to it rather
  than being re-decided, and the selection clears itself whenever the report changes.

  Fixing needs the references themselves, which only exist for pages scanned in this session — a
  count restored from the document is not enough. Pages in that state say *scan to fix* rather than
  offering a button that would quietly do nothing. Applying a fix spends its references, so the pages
  it touched go back to needing a scan; after a component swap the remaining count is an estimate
  until you rescan, and the page is flagged accordingly.
- **Local tokens** — local variables and styles that still point at a library. These never show up on
  a page, and they are what keeps a file tethered after every page looks clean. They have to be
  repointed in Figma's own Variables panel; the plugin tells you which local token to pick.
- **Selection** — scan just what is selected. Useful for checking one frame before committing to a
  whole page.

## Match safety

Auto-fix will not guess. Matches are tiered, and the tier is shown on every row:

| Tier | Meaning | Applied automatically |
| --- | --- | --- |
| `exact` | Identical name | yes |
| `strong` | Same name modulo casing, separators, or a library prefix (`Primitives/color/red/500` → `color/red/500`) | yes |
| `weak` | Last two name segments match, **or** the component sits on a page named after it | only if you turn it on in Settings |
| `risky` | Only the final segment matches, or an approximate name match | never — use **Remap…** |

Components are searched **page-first**: a candidate on the page being fixed beats an identically
named one elsewhere, which also settles the ambiguity that would otherwise stop a duplicate name
applying automatically. The file-wide index is the fallback, and only then is a reference treated as
unfixable.

The page-name tier exists because a design system usually gives a component its own page. If
`Backdrop (OC)` no longer resolves but a page called `Backdrop (OC)` holds a component — even one
renamed to just `Backdrop` — that is almost certainly the replacement. It is offered at `weak`, so it
shows up in the review sheet rather than being applied behind your back.

When nothing matches at all, the group lists the closest local names with their scores and pages, so
"no local match" can be told apart from "the index never saw it".

Approximate matching also refuses any pair that looks like two siblings in a scale rather than the
same token spelled differently. `spacing/xs` and `spacing/xl` are one character apart; binding one to
the other would silently change the design, so the plugin will not do it on its own.

Component swaps snapshot the instance's genuine variable-bound paint and effect **overrides** and
re-apply them afterwards, because `swapComponentAsync` does not reliably carry them. Only real
overrides are captured — preserving inherited bindings would drag the old library's styling across
the swap. When remote instances are nested, only the outermost is swapped; that re-links the whole
subtree in one operation.

That re-application is deliberately conservative. A binding is only restored when its layer can be
located unambiguously in the new main — same position and name, or a name that is unique among its
siblings. Duplicate sibling names like `Icon` or `Vector` are routine, and Figma's swap already
preserves overrides with its own heuristics, so guessing would mean writing a binding onto a layer
you never touched. Anything that cannot be placed is counted and reported: *"3 variable-bound
overrides could not be carried across — check this instance"*. A fix that reports a warning has still
changed the file; the warning tells you where to look.

## Unbinding

Some references cannot be rebound at all — the variable was deleted from its collection and no local
equivalent exists under any name. For those, **Unbind** drops the binding and keeps the value the
layer currently shows. It renders identically, and the file stops pointing at a token that is gone.

An absolute value beats a dangling reference: the reference is already resolving to that number or
colour, it just also carries a pointer nothing can follow.

Unbind appears exactly where Fix cannot help — on a row, on a group (`Unbind 9`), and on the page
(`Unbind N` in the review note, covering every variable with no local equivalent). It is never
automatic, and it is never offered where a confident rebind exists. Figma's undo reverses it like any
other edit.

Caveat worth knowing: unbinding freezes the value of the *currently resolved mode*. If the layer was
picking up a different value in another mode, it will not do so any more. For a variable that is
already broken this is moot — there is only the last-known value — but it matters if you unbind a
binding that still works.

`componentProperties` bindings are unbound by re-setting the property to its current value. Per-range
text bindings unbind through the range setters like any other. Only gradient stops stay manual —
`ColorStop` carries the binding and there is no setter for it.

## Rich text

Bindings inside rich text are handled per character range, not per node. `node.boundVariables`
flattens every range into one array with the ranges stripped out, which makes a paragraph of mixed
styling look unfixable; the styled segments keep them intact. The scan reads
`getStyledTextSegments(['boundVariables','fills'])`, so each run is a reference of its own, showing
which characters it covers — `fontSize on characters 0–12`.

Fixing writes back the same way, through `setRangeBoundVariable(start, end, field, variable)` and
`setRangeFills(start, end, paints)`, so rebinding one run leaves the rest of the paragraph alone. A
uniform fill is still recorded once at node level rather than once per run.

## Known limits

- **Instance depth.** By default the plugin reports each instance once and additionally inspects
  layers the file genuinely overrode. Content a designer never touched belongs to the main component,
  not to this file, so rebinding it is impossible and listing it is noise. *Settings ▸ Instance depth
  ▸ Every nested layer* walks everything, at a large cost on big files.
- **Invisible instance children** are not scanned. `figma.skipInvisibleInstanceChildren` is on because
  it is worth several times the traversal speed; hidden layers inside an instance come from the main
  component anyway.
- **Local tokens are read-only.** The plugin API cannot safely rewrite a variable's per-mode value or
  a style's binding, so those are reported with a suggested target rather than fixed.
- **Source library names** are only truthful for variables, via `figma.teamLibrary`. Figma exposes no
  equivalent for styles or components, so those fall back to the first segment of the name path.
- **Gradient stop colours** are detected but not auto-fixable. A gradient's bindings live on each
  `ColorStop`, and the API has no `setBoundVariableForColorStop`, so a gradient built from library
  colours is reported and left for you to repair in Figma.

## How the scan got fast

The scan is split in two phases, because remote references are extremely repetitive — 5,000 text
nodes usually share a handful of text styles.

1. A fully **synchronous** tree walk emits flat reference records. No `await` inside the walk, so a
   page is one uninterrupted burst.
2. Those records are **deduped to unique resource ids**, and each id is resolved exactly once in
   `Promise.all` chunks with a macrotask yield between them.

That turns an `O(nodes)` async cost into `O(distinct references)`. The previous version awaited a
lookup per node per property, slept a fixed 10 ms every 50 nodes, and leaked an uncleared timer on
every call.

Cancellation uses a generation token rather than a boolean. A boolean cannot tell "the user
cancelled" from "a newer scan superseded this one", and the old sticky flag meant that after one
Cancel every later scan reported zero and wrote that into the document.

## Files

| File | Purpose |
| --- | --- |
| `code.js` | Scan engine, matcher, fix engine, persistence |
| `ui.html` | Sidebar + detail panel, progress strip, review sheet, remap picker |
| `manifest.json` | `documentAccess: dynamic-page` |

Document plugin data: `obraLibScan.index.v2` (per-page counts, travels with the file),
`obraLibScan.settings.v1`, `ignoredPageIds`.

---

CC BY 4.0 · ©Obra Studio 2026
