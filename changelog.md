# Change Log

## v0.3.0

Hibiki HTML is now licensed under the OSI approved MPL v2 (Mozilla Public License)!
More information here: https://www.mozilla.org/en-US/MPL/2.0/FAQ/

Lots of under the hood changes to make writing UI component libraries
easier and more straight-forward.

* 'unwrap' attribute to remove an enclosing tag and just render its children as a fragment
* allow &lt;define-vars&gt; to receive context as a text node
* dev builds report a version number
* custom nodes fire an internal 'init' event when first created (before rendering)
* do not throw an error when setting a read-only value (silently ignore) -- e.g. setting value in args root
* h-text will show '[noattr]' when printing noattr value instead of null
* added ChildrenVar.filter to allow filtering of children by LambdaValue expression
* added ChildrenVar.size -- returns number of children in ChildrenVar
* fixes and improved consistency for using and filtering multiple levels of children nodes
* consistent behavior of "if-break" and "define-vars" when embedded as children of custom component
* breaking: removed ChildrenVar.list (inconsisten behavior, not resolved)
* added ChildrenVar.node (first node of ChildrenVar)
* added ChilcrenVar.nodes (array of node objects)
* added innerhtml and outerhtml to node var
* updated when welcome message and usage ping to fire on library load.  can be suppressed using HibikiGlobalConfig
* updated click and submit handlers to only automatically call event.preventDefault() when the href or action attributes are not present or set to "#".
* removed h-withcontext node (define-vars is more powerful)
* define-vars, inline context attribute renamed from 'context' to 'datacontext' (to match h-children)
* define-component, initial component data attribute renamed from 'defaults' to 'componentdata'
* added new fn:floor and fn:ceil math functions
* define-vars, datacontext, and componentdata blocks are now parsed once when HTML is loaded (not on demand)
* bugfix: class.[class] was not being properly set to false when set to the Hibiki value false
* bugfix: and/or operators were not correctly evaluating 'noattr' as false
* bugfix: fix component defaults, define-vars, and h-withcontext, to never update mobx state

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
* wording updates to license to make it more clear
* added setTimeout, setInterval, and clearInterval to HibikiModule
* (breaking) removed 'h-dateformat' from core (removes dayjs dependency).  will re-add in separate library
* (breaking) removed 'debug' statement, can use @debug on log statement (log statement now accepts named parameters)
* (breaking) only allow references to $ and $c.  this affects some components that made explicit references to the $args root

## v0.1.0

Hibiki HTML initial release.
