# Change Log

## v0.3.3

* HibikiGlobalConfig preRenderHook and postRenderHook (receives state and DOM node)
* Added getStateName() to HibikiState (set from 'name' attribute on hibiki template element)

## v0.3.2

* new array functions: fn:filter(), fn:map(), fn:find(), fn:findindex(), fn:reduce(), fn:reverse(), fn:every(), fn:some(), fn:concat(), fn:join(), fn:shift(), fn:unshift()
* fn:indexof() now works for both strings and arrays
* fn:trimindent() to detect and remove constant number of spaces from lines
* fn:replace(), fn:replaceall() for string replacement (no regex support yet)
* add //@hibiki/confirm() and //@hibiki/alert()
* rename //@hibiki/setInterval and //@hibiki/setTimeout to //@hibiki/set-interval and //@hibiki/set-timeout (old names still work).  add //@hibiki/clear-timeout
* special syntax to turn html comments to hibiki text nodes using "hibiki:text" or "hibiki:rawtext"
* bugfix: fix isnoattr() to not throw errors

## v0.3.1

More internal changes and features to support complex UI component libraries.
Start a set of standard versioned Hibiki HTML libraries that can be loaded using a special &lt;import-library lib="..."&gt; syntax.
Standard library source code is available on GitHub at https://github.com/dashborg/hibiki-libs with 
templates and instructions on how to build custom libraries that integrate existing JS libraries and React controls.

* import Standard Hibiki HTML libraries using &lt;import-library lib="[LIBRARY-NAME]@[VERSION]"&gt;&lt;/import-library&gt;
* removed 'alert' statement, use log(..., @alert=true);
* removed 'bubble' statement, use fire->event(..., @bubble=true);
* allow 'fire' statement to take nodeuuid as at-arg, fire->event(..., @nodeuuid="expr");
* added 'nosort' option to fn:sort()
* HibikiRequest.data is now params stripped of at-args (and positional args)
* added deref() expression which removes one level of ref()
* allow getters on HibikiBlob oject (mimetype, bloblen, name, base64), fn:blob funcs are now obsolete
* new @event context var passed to all native handlers (and propagated if events are re-fired) that wraps react synthetic event
* HibikiEvent object, 'type' getter, and 2 lambda getters that can be invoked (stopPropagation, and preventDefault)
* rename $c._hibiki to $c.@hibiki ($c.@hibiki.uuid contains node uuid)
* new whitespace elimination rules in hibiki html parser.  by default, trims whitespace from beginning and end of node's children (except for 'pre', 'code', and 'script' tags).  removes any whitespace-only nodes from special HTML nodes like 'ul', and table nodes).
* added 'hibiki:ws' attribute to override whitespace handling for node, modes = "none", "all", "trim", and "trim-nl"
* new hibiki attribute namespace, 'h:' or 'hibiki:' attributes for hibiki specific functionality
* moved 'innerhtml' and 'outerhtml' special attributes to hibiki namespace
* added aliases for 'foreach', 'automerge', 'if', and 'unwrap' attributes in hibiki namespace: e.g. 'hibiki:foreach', 'hibiki:automerge', 'h:unwrap'
* allow script type="module" for inline hibiki script nodes
* no longer allow rendering Hibiki HTML directly to 'body' tag (bad interactions with 3rd party libraries)
* 'foreach' will now skip keys that start with '@' on ojects.  to iterate over them, use fn:objallkeys().
* added fn:objkeys(), fn:objatkeys() and fn:objallkeys() to return object keys (also work with HibikiWrappedObj).  objkeys omits any keys starting with '@', objallkeys returns all keys (include @), and objatkeys only returns @ keys.
* added 'type' and 'data' getters to HibikiError object
* http module errors set error.type to 'http' and error.data to an object with 'status', 'statustext', and 'data' (parsed error response).  can be used to inspect and use error responses (e.g. JSON error bodies with non-200 status codes)
* if http module encounters unparsable json, it will throw an error, and set error.data.data to a blob with mimetype 'text/json-unparseable'
* http network errors get error.data.status set to 599, and err.data.statustext to 'Network Error'
* attributes prefixed with 'html-' will overwrite non-prefixed attributes in HTML nodes.  workaround for chrome/firefox issues where &lt;img&gt; src tags are getting preloaded, even in &lt;template&gt; or AJAX requests.  now you can write &lt;img html-src="*..."&gt; without causing an extra browser request.
* assignment to a ref will set data one-level deep (will not recursively traverse refs), use deref() manually to set deep refs
* internal: new HibikiParamsObj to manage position/named params in a more structured way
* internal: HibikiParamsObj passed to jsfuncs
* internal: HibikiParamsObj available in HibikiRequest object
* bugfix: inconsistencies in accessing getters on HibikiNode object
* bugfix: more consistent handling of noattr args in jsfuncs (stripped out by HibikiParamsObj)
* bugfix: rendering of text inside of html option tag
* bugfix: don't call preventDefault on bubbled click events (allows anchor tags to work as expected even if a click.handler is defined)

## v0.3.0

Hibiki HTML is now licensed under the OSI approved MPL v2 (Mozilla Public License)!
More information here: https://www.mozilla.org/en-US/MPL/2.0/FAQ/

Lots of under the hood changes to make writing UI component libraries
easier and more straight-forward.  Tightened up the core tag library
by removing 'h-if', 'h-withcontext', 'h-foreach', and 'h-if-break' (all of that
functionality is available via attributes or other constructs).

* 'unwrap' attribute to remove an enclosing tag and just render its children as a fragment
* allow &lt;define-vars&gt; to receive context as a text node
* dev builds report a version number
* do not throw an error when setting a read-only value (silently ignore) -- e.g. setting value in args root
* h-text will show '[noattr]' when printing noattr value instead of null
* added ChildrenVar.filter to allow filtering of children by LambdaValue expression
* added ChildrenVar.size -- returns number of children in ChildrenVar
* fixes and improved consistency for using and filtering multiple levels of children nodes
* consistent behavior of "if-break" and "define-vars" when embedded as children of custom component
* breaking: removed ChildrenVar.list (inconsistent behavior, not resolved)
* added ChildrenVar.node (first node of ChildrenVar)
* added ChildrenVar.nodes (array of node objects)
* added innerhtml and outerhtml to node var
* updated when welcome message and usage ping to fire on library load.  can be suppressed using HibikiGlobalConfig
* updated click and submit handlers to only automatically call event.preventDefault() when the href or action attributes are not present or set to "#".
* removed h-withcontext node (define-vars is more powerful)
* removed h-if, h-foreach, h-if-break.  can all be accessed by adding attributes to existing nodes (or to h-fragment nodes)
* define-vars, inline context attribute renamed from 'context' to 'datacontext' (to match h-children)
* define-component, initial component data attribute renamed from 'defaults' to 'componentdata'
* added new fn:floor and fn:ceil math functions, and fn:deepcopy
* define-vars, datacontext, and componentdata blocks are now parsed once when HTML is loaded (not on demand)
* components now fire 'mount' event internally (as well as externally)
* change to grammar to allow functions (fn) to receive named parameters
* added spaceship '<=>' operator for comparison
* 'noattr == null' is now true, added 'isnoattr(expr)' to distinguish the noattr case
* added new fn:uppercase and fn:lowercase string functions
* added new fn:compare function (supports locales, sensitivity, and numeric/string comparisons)
* added new fn:sort function (uses fn:compare options) with makerefs parameter which can sort an array as references to link sorted values with originals
* add makerefs parameter to fn:slice, allowing the returned array to link to the original
* when evaluating a raw() expression, allow creation of sub-references.  if raw(@v) is a refernce, now raw(@v.subfield) will also evaluate to a reference.
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
