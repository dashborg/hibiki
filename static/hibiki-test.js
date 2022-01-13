// Copyright 2021-2022 Dashborg Inc

// sets up a very basic HTML page that
// includes hibiki-dev.js, the JS prereqs, and Bulma for testing.

var scriptQueue = [];

function writeScript(src) {
    let tag = document.createElement("script");
    tag.src = src;
    tag.addEventListener("load", loadScriptQueue);
    document.querySelector("head").appendChild(tag);
}

function loadScriptQueue() {
    if (scriptQueue.length == 0) {
        return;
    }
    let nextSrc = scriptQueue.shift();
    writeScript(nextSrc);
}

function writeStyleSheet(href) {
    let tag = document.createElement("link");
    tag.rel = "stylesheet";
    tag.href = href;
    document.querySelector("head").appendChild(tag);
}

function testMode() {
    let params = new URLSearchParams(window.location.search);
    if (params.get("mode") == "test") {
        return "test";
    }
    if (params.get("mode") == "prod") {
        return "prod";
    }
    if (window.location.host.match(/(^localhost|(^|\.)hibiki-dev.com)(\:\d+)?$/)) {
        return "test";
    }
    return "prod";
}

if (testMode() == "test") {
    scriptQueue.push("https://cdnjs.cloudflare.com/ajax/libs/react/17.0.2/umd/react.production.min.js");
    scriptQueue.push("https://cdnjs.cloudflare.com/ajax/libs/react-dom/17.0.2/umd/react-dom.production.min.js");
    scriptQueue.push("https://cdnjs.cloudflare.com/ajax/libs/mobx/5.15.4/mobx.umd.min.js");
    scriptQueue.push("/dist/hibiki-dev.js");
}
else {
    scriptQueue.push("https://cdn.hibikihtml.com/hibiki/latest/hibiki-prod.min.js");
}
loadScriptQueue();
writeStyleSheet("https://cdn.jsdelivr.net/npm/bulma@0.9.2/css/bulma.min.css");
writeStyleSheet("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css");
writeStyleSheet("/test.css");

