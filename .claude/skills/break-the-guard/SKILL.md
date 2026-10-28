---
name: break-the-guard
description: Prove that a test, check or validation really guards what it claims, by breaking the guarded thing on purpose and watching for the failure. Use when you have just written or changed a test, a check, a shape or a guard, before calling it done, or when a guard passed on its first run. Covers choosing the mutation, running it with bin/break-guard.js, reading the verdict, and the ways a mutation proves nothing.
---

# Breaking a guard once, on purpose

[CLAUDE.md](../../../CLAUDE.md) says to break every guard once. A test that passes with the thing it guards broken is not a guard,
and it looks exactly like one. It has happened here repeatedly: a check of the vitest include list that lived in a suite that list
governed, a refusal test that a different refusal also satisfied, and, while building the HTML skin work, a width sweep that passed
the broken skin twice, and a skills test that bound one of three quoted figures. Each was found only by breaking the thing.

## 1. Run the command first, unmutated

It must pass as it is. A command that already fails "catches" every mutation, which proves nothing about any of them. This repository
has known failing tests, so name the narrow test file, not the whole suite. `bin/break-guard.js` runs the command once unmutated
and refuses to go on if it fails.

## 2. Choose a mutation that breaks the rule, not just a line

Break the thing the guard is for. Good mutations, each from a real case:

- **Remove the check** the guard exists to make (delete the origin comparison, skip the exactly-once test).
- **Invert or widen it:** let `position: fixed` into an allowlist, let `!` into the characters a value may hold, count a failure as a pass.
- **Revert the fix.** If a bug was found, put it back: the test written for it must go red. This is the strongest kind.
- **Shrink the list the guard walks**, or add a member the guard has never seen, and see whether it notices. A guard is only as wide as
  the list it walks, and nobody re-reads the list.
- **Break the default, the first and the empty case,** which fixtures usually skip.

A mutation that does not actually violate the rule proves nothing when it survives. Before reading a survivor as a gap, ask: does this
edit really break the behaviour, or only change the text? (One "optimistic render" mutation here set an attribute and changed nothing
the test could see.)

## 3. Run it

```sh
node bin/break-guard.js --file src/ui/Focus.js \
  --from "const inner = active?.shadowRoot?.activeElement" --to "const inner = null" \
  -- npx vitest run tests/ui/Focus.test.js
```

It replaces that exact text, once, in that file, runs the command, and **puts the file back byte for byte** whatever happens. Never
do this by hand with `sed` and a copy: a `sed` that matches nothing changes nothing and reports nothing, which looks like a
survivor, and a forgotten restore leaves the repository broken. It prints, before touching anything, where a copy of the original is kept, so even a process killed outright leaves a way back. Do not use git to undo or compare: the index and the working tree are the maintainer's.

| Exit | Verdict | What to do |
|---|---|---|
| 0, one test failed | Caught, by the right amount of test | Check the failing test's name is the reason you broke. Done |
| 0, several failed | Caught, but too widely | The mutation may be too big, or the tests overlap. Check each fails for the reason you broke |
| 0, none named | The command failed without a failing test | Read the output: it may have failed for another reason (a syntax error in the mutation) |
| 1 | **Survived** | Nothing guards this. Write the missing test, then run the same mutation again |
| 2 | Not run | The text is not in the file exactly once, the command fails unmutated, or the file could not be restored |

## 4. A survivor is the useful result

Fix it by writing the test that was missing, then **run the same mutation again until exactly one test catches it**. Real survivors
from this work: a "takes the text literally" test that checked the exit code and never what the command saw, so `$&` in a replacement
passed; a check on the restore that could not fail, which turned out to be dead code, and the real case (a restore that fails) was
unhandled; a test that walked only the plugin it was written from. Fixing a survivor sometimes means fixing the code.

## 5. Ways a mutation proves nothing

- **The baseline is red.** See section 1.
- **It fails for another reason.** A refusal test must assert the *reason*, not a string a different refusal also prints. The composite
  cycle test passed with the cycle check deleted because the depth limit printed the same chain.
- **A digested artefact.** Mutating a file whose digest is in a profile changes behaviour and digest together, so the refusal comes from
  the digest and proves nothing. Regenerate the profile first (the plugin's `build.sh`).
- **The guard depends on the thing it guards.** Delete the entry from the list and the test that reads the list goes with it. Run the
  guard from outside the thing, as `bin/check-suites.js` runs outside vitest.
- **It is flaky.** A guard that fails sometimes without a mutation is not caught by this: run the baseline several times if it touches
  Chrome or timing, and say so.
- **The guard cannot run.** A check that exits 3 because Chrome is missing has checked nothing. That is not a pass either way.

## 6. Finish

Record what was broken and what caught it, in the words of the verdict, so the claim "this is guarded" has evidence behind it. If a
survivor taught something that applies beyond one test, it is a candidate for CLAUDE.md or MISTAKES.md, but tell the maintainer
rather than editing them yourself.
