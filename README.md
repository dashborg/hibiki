# Hibiki HTML

Hibiki HTML is a powerful new web framework for creating
modern, dynamic, frontend applications *without* JavaScript, that can be
fully [scripted and controlled by backend code](#hibiki-actions).

Hibiki HTML is compatible with any backend language or framework, any
CSS framework, and any existing backend template language.

For an interactive walkthrough please check out the 
[Hibiki HTML Interactive Tutorial](https://playground.hibikihtml.com/tutorial/).

## Hibiki HTML Resources

* **Source Code on GitHub** - https://github.com/dashborg/hibiki
* **Tutorial** - https://playground.hibikihtml.com/tutorial/
* **Playground** - https://playground.hibikihtml.com
* **Codepen Template** - https://codepen.io/pen/?template=QWMBgPg
* **Issue Tracker** https://github.com/dashborg/hibiki/issues
* **Homepage** - https://hibikihtml.com
* **Reference Documentation** - https://docs.hibikihtml.com
* **Join Discord for Questions** - https://discord.gg/zbWV6ueED7

## Getting Started

Getting started is easy.  There is no JavaScript stack to set up, no boilerplate/scaffolding, and
no build tools to download and run.
Just add one script tag to the top of your page or template:

```
<script src="https://cdn.hibikihtml.com/hibiki/latest/hibiki-prod.min.js"></script>
```

Wrap any portion of your content with a &lt;template hibiki&gt; tag and you have your first
Hibiki HTML app.  All plain HTML content is rendered as is, and because Hibiki HTML uses the browser's HTML parser,
it follows the same rules as standard browser HTML.

Note that all these code examples can be viewed and edited in the 
[Hibiki HTML Playground](https://playground.hibikihtml.com).

```
<template hibiki>
  <h1 class="title">&#x1f338; Hibiki HTML</h1>
  <p>Hibiki HTML <i>is</i> HTML</p>
</template>
```
(Playground Link - https://playground.hibikihtml.com/?codeid=readme-gs)

## Data / Rendering Dynamic Content

Hibiki HTML applications have a built-in frontend data model.  You can initialize it with
any JSON object using the ```<hibiki-data>``` tag.  To render text use
the ```<h-text>``` tag or inline ```{{ ... }}``` syntax.  Attributes and style properties
are evaluated dynamically if they start with a ```*```.

```
<template hibiki>
  <hibiki-data>
    {"color": "blue", "name": "Mike"}
  </hibiki-data>
  <p>
    {{ $.name }}'s favorite color is 
    <span style="font-weight: bold; color: *$.color">{{ $.color }}</span>
  </p>
</template>
```
(Playground Link - https://playground.hibikihtml.com/?codeid=readme-data-1)

Hibiki HTML supports a full expression language, including all of the standard conditional and arithmetic
operators.  Additional classes can be turned on/off using the shorthand
attribute syntax ```class.[class-name]="true/false expression"```.
```
<template hibiki>
  <hibiki-data>
    {"numlights": 4, "selected": true, "index": 5, "isprimary": true}
  </hibiki-data>
  <div class="box" style="font-weight: *($.selected ? 'bold' : 'normal')">
    Bold Text (if selected)
  </div>
  <div class="box">Index: <h-text bind="$.index + 1"></h-text></div>
  <div class="box">
    There are {{$.numlights}} light{{$.numlights > 1 ? 's' : ''}}
  </div>
  <div class="box">
    <button class="button" class.is-primary="*$.isprimary">Primary Button</button>
  </div>
</template>
```
(Playground Link - https://playground.hibikihtml.com/?codeid=readme-data-2)

You can conditionally include elements using the ```if``` attribute.  Looping
is handled by the ```foreach``` attribute.  You can loop over arrays or
objects.  The foreach attribute uses a special syntax of ```@item in $.array```,
where every iteration ```@item``` will be assigned to an element of the array or object.
If you provide a second variable it will capture the array index or element key:
```(@item, @key) in $.object``` or ```(@item, @idx) in $.array```.

```
<template hibiki>
  <hibiki-data>
    {"fruits": [{"name": "apple", "emoji": "&#127822;"},
                {"name": "banana", "emoji": "&#127820;"}, 
                {"name": "blueberry", "emoji": "&#129744;"}], 
     "selected": "banana"}
  </hibiki-data>
  <div class="content box">
    <ul>
      <li foreach="@fruit in $.fruits">
        {{ @fruit.name }} {{ @fruit.emoji }}
        <span if="@fruit.name == $.selected">(selected)</span>
      </li>
    </ul>
  </div>
</template>
```
(Playground Link - https://playground.hibikihtml.com/?codeid=readme-data-3)

## Handlers

To update data (and dynamically change content), Hibiki HTML supports *handlers*.  Basic handlers respond to
events like *click*, *mount*, *submit*, *change*, etc.

```
<template hibiki>
  <hibiki-data>{"color": "blue"}</hibiki-data>
  <div class="box" style="background-color: *$.color; color: white">
    The color is {{$.color}}
  </div>
  <button class="button" click.handler="$.color = 'green'">Change Color</button>
</template>
```
(Playground Link - https://playground.hibikihtml.com/?codeid=readme-handlers-1)

You can make remote AJAX calls for JSON data using a remote handler.  In this example
the call to https://testapi.hibikihtml.com/api/get-color-1 will return the JSON
response ```{"color": "purple"}```.  We assign it to a *context variable* ```@resp``` and
then assign ```$.color = @resp.color```.

```
<template hibiki>
  <hibiki-data>{"color": "blue"}</hibiki-data>
  <div class="box" style="background-color: *$.color; color: white">
    The color is {{$.color}}
  </div>
  <button class="button" click.handler="$.color = 'green'">Change Color</button>
  <button class="button"
    click.handler="@resp = GET https://testapi.hibikihtml.com/api/get-color-1; $.color = @resp.color;">
    GET /api/get-color-1
  </button>
</template>
```
(Playground Link - https://playground.hibikihtml.com/?codeid=readme-handlers-2)

You can make GET, POST, PUT, PATCH, or DELETE requests by changing the verb in front of the URL.  You can
pass query arguments (or JSON data bodies) by passing arguments to your handler by using ```(arg1=val1, arg2=val2...)``` (complex arguments will be JSON encoded), and you can define local handlers using the ```define-handler``` tag for convenience and reuse.

```
<template hibiki>
  <hibiki-data>{"color": "blue"}</hibiki-data>
  <define-handler name="//@local/get-color">
    @resp = GET https://testapi.hibikihtml.com/api/get-color-1(name="Michelle");
    $.color = @resp.color;
  </define-handler>
  <div class="box" style="background-color: *$.color; color: white">
    The color is {{$.color}}
  </div>
  <button class="button" click.handler="$.color = 'green'">Change Color</button>
  <button class="button" click.handler="//@local/get-color">
    Get Michelle's Color
  </button>
</template>
```
(Playground Link - https://playground.hibikihtml.com/?codeid=readme-handlers-3)

Connecting to an existing API?  Don't worry, Hibiki HTML handlers support advanced options
like CORS, CSRF, parameter encodings, BLOB results, and multipart file uploads.

## Hibiki Actions

The magic of Hibiki HTML is that every handler is really just a series of actions.  *Hibiki Actions*
are primitives like *setdata*, *if*, *callhandler*, *fireevent*, *invalidate*, *html*, etc.  Every action
that can you can write in a handler, also has a JSON representation.

This means we can write a *backend* handler that returns a JSON response that scripts
and updates the frontend!  Here's an example JSON response that is equivalent to running
```$.color = 'DeepSkyBlue'``` on the frontend:

```
{"hibikiactions": [
    {"actiontype": "setdata", "setpath": "$.color", "data": "DeepSkyBlue"}
]}
```

I've set up https://testapi.hibikihtml.com/api/set-color-action to return just that.  Now
if we have our click handler call that URL, we'll see the color change automatically.

```
<template hibiki>
  <hibiki-data>{"color": "red"}</hibiki-data>
  <div class="box" style="background-color: *$.color; color: white">
    The color is {{$.color}}
  </div>
  <button class="button" click.handler="$.color = 'green'">Change Color</button>
  <button class="button" click.handler="GET https://testapi.hibikihtml.com/api/set-color-action;">
    Backend Set Color Action
  </button>
</template>
```
(Playground Link - https://playground.hibikihtml.com/?codeid=readme-actions-1)

Backend handlers are *very* powerful.  You can set return values, return data and BLOBs (like images) in
one request, mix frontend and backend data with expressions, conditionally execute actions, and more.
You can also use backend handlers to create multi-page Hibiki HTML applications by returning a
new HTML template to be rendered.

## Components and Libraries

Hibiki HTML makes it easy to use, share, and bundle components for easy reuse.  The ecosystem is just getting 
started, but you can write native Hibiki HTML components, link to 3rd party JavaScript (D3, CodeMirror, etc.),
and import ReactJS components.

```
<template hibiki>
  <define-component name="colorbox">
    <div class="box" style="background-color: *$args.color; color: white">
      The color is {{$args.color}}
    </div>
  </define-component>
  
  <local-colorbox color="green"></local-colorbox>
  <local-colorbox color="blue"></local-colorbox>
  <local-colorbox color="purple"></local-colorbox>
</template>
```
(Playground Link - https://playground.hibikihtml.com/?codeid=readme-comps-1)

## Interactive Tutorial

Want to learn more?  Check out the [Interactive Tutorial](https://playground.hibikihtml.com/tutorial/).

---

## Open Source

The source code for Hibiki HTML is available on GitHub at at: https://github.com/dashborg/hibiki .  It is licensed under the Mozilla Public License v2.0 -- https://mozilla.org/MPL/2.0/ .

Mozilla has an excellent [FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/), but basically this license allows you to use Hibiki HTML in any project (personal, commercial, or open-source).  The only restriction is if you modify any of the *Hibiki HTML source files* you must make the source code of those changes available.

## Credits

Hibiki HTML is an open source version of the frontend language originally built and designed for
the [Dashborg](https://dashborg.net) internal tools framework.  The Hibiki HTML core is built in [TypeScript](https://www.typescriptlang.org/), using
[React](https://reactjs.org/), [MobX](https://mobx.js.org/), and [Nearley](https://nearley.js.org/). 
The Hibiki HTML playground is built in Hibiki HTML, also using 
[CodeMirror](https://codemirror.net/) and [Bulma](https://bulma.io).

## Support and Help

Hibiki HTML is under active development.  Please contact me by email [mike (at) hibikihtml.com] 
or on Discord if you have a question, to report a bug, need help, or would like to contribute.

I'm excited to see Hibiki HTML working in the real world.  If you have an application that you're
thinking about using Hibiki HTML for, please reach out.  I'm happy to help, build out additional
functionality/components, or do team training.

[Join the Hibiki HTML Discord Server](https://discord.gg/zbWV6ueED7)


