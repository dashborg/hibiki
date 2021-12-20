# Hibiki HTML

Hibiki HTML is a powerful new web framework for creating
modern, dynamic, frontend applications *without* JavaScript, that can be
fully [scripted and controlled by backend code](#hibiki-actions).

Hibiki HTML is compatible with any backend language or framework, any
CSS framework, and any existing backend template language.

For an interactive walkthrough please check out the 
[Hibiki HTML Interactive Tutorial](https://playground.hibikihtml.com/tutorial/).

## Hibiki HTML Resources

* **Homepage** - https://hibikihtml.com
* **Full Documentation / Reference** - https://docs.hibikihtml.com
* **Tutorial** - https://playground.hibikihtml.com/tutorial/
* **Playground** - https://playground.hibikihtml.com
* **Codepen Template** (https://codepen.io)
* **Source Code on GitHub** - https://github.com/dashborg/hibiki
* **Issue Tracker** https://github.com/dashborg/hibiki/issues
* **Slack Channel for Questions** - https://slack.com

## Getting Started

Add one script tag to the top of your page/template:

```
<script src="https://staticfiles.dashborg.net/static/latest/hibiki-prod.min.js"></script>
```

Wrap any portion of your content with a &lt;template hibiki&gt; tag and you have your first
Hibiki HTML app.  All plain HTML content is rendered as is, and because Hibiki HTML uses the browser's HTML parser,
it follows the same rules as standard browser HTML.

Note that all these code examples can be viewed and edited in the 
[Hibiki HTML Playground](https://playground.hibikihtml.com).  They use
the excellent [Bulma CSS Library](https://bulma.io) to help with styling.

```
<template hibiki>
  <h1 class="title">&#x1f338; Hibiki HTML</h1>
  <p>Hibiki HTML <i>is</i> HTML</p>
</template>
```
(Playground Link - https://playground.hibikihtml.com/?codeid=first-app)

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
(Playground Link - https://playground.hibikihtml.com/?codeid=data-1)

Hibiki HTML supports a full expression language, including all of the standard conditional and arithmetic
operators.  Additional classes can be turned on or off using the shorthand
attribute syntax ```class.[class-name]="true/false"```.
```
<template hibiki>
  <hibiki-data>
    {"numlights": 4, "selected": true, "index": 5, "isprimary": true}
  </hibiki-data>
  <div class="box" style="font-weight: *($.selected ? 'bold' : 'normal')">
    Bold Text (if selected)
  </div>
  <div class="box">Index: <h-text bind="$.index + 1"></div>
  <div class="box">
    There are {{$.numlights}} light{{$.numlights > 1 ? 's' : ''}}
  </div>
  <div class="box">
    <button class="button" class.is-primary="*$.isprimary">Primary Button</button>
  </div>
</template>
```

You can also conditionally include elements using the ```if``` attribute or ```<h-if>``` tag.  Looping
is handled by the ```foreach``` attribute or ```<h-foreach>``` tag.  Within a loop, the loop item is
accessible as ```$local```.

```
<template hibiki>
  <hibiki-data>
    {"fruits": [{"name": "apple", "emoji": "&#127822;"},
                {"name": "banana", "emoji": "&#127820;"}, 
                {"name": "blueberry", "emoji": "&#129744;"}], 
     "selected": "banana"}
  </hibiki-data>
  <ul>
    <li foreach="$.fruits">
      {{ $local.name }} {{ $local.emoji }}
      <span if="$local.name == $.selected">(selected)</span>
    </li>
  </ul>
</template>
```

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
if we have our click handler call that URL, we'll see the color change.

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
  <define-component name="colorbox" args="color">
    <div class="box" style="background-color: *$c.color; color: white">
      The color is {{$c.color}}
    </div>
  </define-component>
  
  <local-colorbox color="green"></local-colorbox>
  <local-colorbox color="blue"></local-colorbox>
  <local-colorbox color="purple"></local-colorbox>
</template>
```

## Open Source-ish

The source code for Hibiki HTML is available on GitHub at at: https://github.com/dashborg/hibiki .  It is licensed under a modified form of the MIT license (similar in spirit to the Confluent open source license) which allows you to use Hibiki HTML without restrictions for almost all personal or commercial projects.

You just can't create a SaaS service offering a hosted version of Hibiki HTML or one that uses the Hibiki HTML language to offer 3rd party customizability for an existing product or service (see https://github.com/dashborg/hibiki/blob/main/LICENSE).

The Hibiki HTML license is *not* OSI approved.
I know this is an ideological deal-breaker for some, but if you have a purely practical concern, I'm happy
to offer a proprietary license that satisfies your legal department.

## Support and Help

Hibiki HTML is under active development.  Please contact me by email or on Slack if you have a
question, to report a bug, need help, or would like to contribute.

I'm excited to see Hibiki HTML working in the real world.  If you have an application that you're
thinking about using Hibiki HTML for, please reach out.  I'm happy to help, build out additional
functionality/components, or do team training.

[Join the Hibiki HTML Slack Channel](https://join.slack.com/t/dashborgworkspace/shared_invite/zt-uphltkhj-r6C62szzoYz7_IIsoJ8WPg)!
