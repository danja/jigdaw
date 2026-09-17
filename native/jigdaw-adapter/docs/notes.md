# Notes on the adapter

Things worth writing down, found while building it.

## The specification was browser-only

Stated plainly because it is the point of the exercise: before this existed, a JigDAW plugin
could not be loaded by anything but a browser, and nothing said so. The contract describes a
processor written in JavaScript and leaves the module's ABI to the plugin author, which is
the right call for a browser and a dead end for anything else.

The fix was small once seen, and `jig:abi` is optional, so no existing plugin is invalidated
by it. What is uncomfortable is how long it went unnoticed: every reader of the specification
was a browser, so the gap was invisible from inside.

## `jig:paramIndex` exists because a document is not a module

`jig_set_param` takes an index. The obvious way to supply one is the order ports appear in
the profile, and that is wrong: the order is a property of the serialisation, not of the
module. Reserialising the same graph would silently rebind every control. The index is
therefore declared, and the shapes refuse a plugin that declares an ABI without one.

## Two floats and a mono plugin

`Module::output` clamps the channel index to what the module actually has, so a mono plugin
in a stereo host is read twice rather than leaving the right channel silent. That is a host
policy rather than an ABI rule, and it belongs here rather than in the specification: another
host might reasonably pan it instead.

## Blocking the host's buffers

A DAW may hand over any number of frames. A module declares `jig_max_frames`, and passing
more would write past the buffer it published. `run()` therefore walks the block in pieces.
This is the kind of thing that works for months at a 128 frame buffer and fails the first
time somebody chooses 1024.

## The parser refused the format's own blank nodes

The first version of `Turtle.cpp` rejected blank nodes outright, because the profile format
says not to use them. It says something narrower: nothing *addressable* may be a blank node.
A scale point has no identity worth naming and the format uses one there, so the parser was
enforcing a stricter rule than the specification states, against the specification's own
worked example.
