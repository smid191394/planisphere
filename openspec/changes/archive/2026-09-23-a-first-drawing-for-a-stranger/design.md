## Context

See proposal.md for why. What shapes the approach:

- A `planisphere.json` stores absolute paths. An artifact made here and shipped
  would name files on the machine it was made on, so every jump from it would
  fail on a reader's machine — and jumping to the source is what the product is
  for.
- The TypeScript analyzer needs nothing installed: the compiler ships with the
  extension and it runs on the editor's own Node. The Go analyzer ships
  compiled. The other three need a toolchain.
- The command already has two places where it stops and says why, and
  `showWarningMessage` takes buttons, whose handler is an ordinary function.

## Goals / Non-Goals

**Goals:**

- A reader who has installed the extension and has nothing to draw can see a
  real drawing, and every gesture in it works, including jumping to source.
- Nothing new in the Command Palette.

**Non-Goals:**

- A tour, a walkthrough or a welcome page.
- Making artifacts portable between machines. That is worth doing for teams
  who commit a drawing, and it is a change of its own.

## Decisions

### The sample is analysed on the reader's machine, not shipped drawn

Pressing the button runs the TypeScript analyzer over the shipped sample into
the extension's own storage, and opens what it writes. It takes about a second,
needs no toolchain, and the paths in it are real files on that machine, so the
drawing behaves exactly as one of the reader's own.

It is also a self-test: a reader who sees the sample drawn knows their install
works, which is the first thing to establish when anything else fails.

Rejected: shipping a drawn artifact of a real project such as cobra. It is
136 KB, and every jump in it fails, because its paths name the machine it was
made on. A first drawing whose headline gesture is broken is worse than none.

### The sample is a small project, not a toy

Fifteen to twenty types with relationships worth looking at: something that
inherits, something that holds a list of another thing, a couple of interfaces
and an enum, and comments above the declarations so that the panel has
something to show. Names from a plausible domain, not `Foo` and `Bar`: the
drawing is the product's first impression, and a drawing of nonsense says the
product draws nonsense.

It ships as source, under `sample/`. It is the only code in the package that is
not the product.

### Where the offer appears

On the two messages the command already shows, as a button. Nothing is added to
the Command Palette or to the Explorer's menu: a reader who is drawing their own
projects never meets either message, and a command they would use once should
not sit in the palette for ever.

## Risks / Trade-offs

- [The reader waits while the sample is analysed] → Loading the compiler is
  about a second and a half of it, which is the analyzer's floor. It is begun
  when the offer is made rather than when it is accepted, so it runs while the
  message is being read; and the artifact is kept in the extension's storage
  and reused while it is newer than the sample.
- [A reader takes the sample for their own project's drawing] → The drawing is
  opened from the extension's storage, and the sample's names say what it is.
- [The package grows] → Twenty small TypeScript files are a few kilobytes,
  against the 11 MB the package already carries.
