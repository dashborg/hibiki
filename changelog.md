# Change Log

## v0.2.0

Large updates behind the scenes to make the Hibiki HTML data model more consistent.
LValues/references are now explicit, other values are deep-copied when assigned.
Lots of work to make references transparent, but visible when you want them to be.
Simplified code that handles injected and automerged attributes (handling is also
more consistent).  Stronger typing of Hibiki data model values and handling
of special values like Lambda, Blobs, Errors, Nodes, etc.  More consistent handling
of special class and style attributes.

Technically not backward compatible with v0.1.0, but almost all code runs as-is.
Breaking changes are marked with "(breaking)" below.

* lambda/invoke for creating and invoking function-like expressions (useful for components)
* added explicit ref expression for creating lvalues (transparent pointers to data)
* added isref/refinfo/raw expressions for preserving references and getting info about them
* removed custom CSS attribute expansion (was undocumented and unused)
* DeepEqual, DeepCopy, and cycle detection functions that fully support the Hibiki data model
* removed 'classnames' dependency
* new 'cc' attribute namespace for creating camel-cased attributes (useful for passing arguments to native react components)
* explicitly allow (or disallow) getters on special Hibiki objects using allowedGetters() - HibikiNode, ChildrenVar, and HibikiError
* new special format 'json-noresolve' that shows internal Hibiki data structures (LValues, special objects, etc.)
* explicit type for HibikiNode
* (breaking) removed 'h-dateformat' from core (removes dayjs dependency).  will re-add in separate library
* (breaking) removed 'debug' statement, can use @debug on log statement (log statement now accepts named parameters)
* (breaking) only allow references to $ and $c.  this affects some components that made explicit references to the $args root

## v0.1.0

Hibiki HTML initial release.