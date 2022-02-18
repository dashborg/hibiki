// Copyright 2021-2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import camelCase from "camelcase";
import type {HtmlParserOpts, PathType, AutoMergeExpr, AutoFireExpr} from "./types";
import merge from "lodash/merge";
import {sprintf} from "sprintf-js";
import {doParse} from "./hibiki-parser";
import type {HAction, HExpr, HIteratorExpr, ContextVarType} from "./datactx";
import {textContent, rawAttrFromNode, attrBaseName, nodeStr, HibikiWrappedObj} from "./utils";

const styleAttrPartRe = new RegExp("^(style(?:-[a-z][a-z0-9-])?)\\.(.*)");

type NodeAttrType = string | HExpr;

const NODE_ALLOWED_GETTERS : Record<string, boolean> = {
    "tag": true,
    "list": true,
    "innerhtml": true,
    "outerhtml": true,
};

class HibikiNode extends HibikiWrappedObj {
    _type  : "HibikiNode";
    tag    : string;
    text?  : string;
    attrs? : Record<string, NodeAttrType>;
    foreachAttr? : HIteratorExpr;
    handlers? : Record<string, HAction[]>;
    list?  : HibikiNode[];
    style? : Record<string, NodeAttrType>;
    morestyles? : Record<string, Record<string, NodeAttrType>>;
    automerge? : AutoMergeExpr[];
    autofire? : AutoFireExpr[];
    innerhtml? : string;
    outerhtml? : string;
    libContext? : string;
    contextVars? : ContextVarType[];
    mark? : boolean;

    constructor(tag : string, opts? : {text? : string, list? : HibikiNode[], attrs? : Record<string, NodeAttrType>}) {
        super();
        this._type = "HibikiNode";
        this.tag = tag;
        if (opts != null) {
            if (opts.text != null) {
                this.text = opts.text;
            }
            if (opts.list != null) {
                this.list = opts.list;
            }
            if (opts.attrs != null) {
                this.attrs = opts.attrs;
            }
        }
    }

    allowedGetters(key : string) : boolean {
        return NODE_ALLOWED_GETTERS[key];
    }

    getStyleMap(attrName : string) : Record<string, NodeAttrType> {
        if (attrName === "style") {
            return this.style;
        }
        if (this.morestyles == null) {
            return null;
        }
        return this.morestyles[attrName];
    }

    asString() : string {
        return sprintf("[node:%s]", this.tag);
    }

    hibikiTypeOf() : string {
        return "hibiki:node";
    }
};

const PARSED_ATTRS = {
    "bind": true,
    "if": true,
    "unwrap": true,
    "foreach": true,
    "condition": true,
    "automerge": true,
};

const NON_BINDABLE_ATTRS = {
    "bind": true,
    "if": true,
    "unwrap": true,
    "foreach": true,
    "condition": true,
    "automerge": true,
    "style": true,
    "class": true, // including all class.[class] attrs
};

type ParseContext = {
    sourceName : string,
    tagStack : string[],
}

// returns [source, dest, parts]
function splitAmVal(amVal : string) : [string, string, string[]] {
    let match = amVal.match(/^(?:([a-zA-Z0-9]+)(?:=>([a-zA-Z0-9]+))?)?(?:@(.*))?$/);
    if (match == null) {
        return [null, null, null];
    }
    let [_, source, dest, rest] = match;
    if (source == null) {
        source = "self";
    }
    if (dest == null) {
        dest = "self";
    }
    if (rest == null) {
        rest = "all";
    }
    return [source, dest, rest.split("|")];
}

function parseSingleAutomerge(amVal : string) : AutoMergeExpr {
    if (amVal === "1") {
        return {source: "self", dest: "self", include: {"all": true}};
    }
    let [source, dest, parts] = splitAmVal(amVal);
    if (source == null) {
        return null;
    }
    let rtn : AutoMergeExpr = {source: source, dest: dest};
    for (let i=0; i<parts.length; i++) {
        let partStr = parts[i].toLowerCase();
        if (partStr.startsWith("-")) {
            if (!rtn.exclude) {
                rtn.exclude = {};
            }
            if (partStr.length > 1) {
                rtn.exclude[partStr.substr(1)] = true;
            }
        }
        else if (partStr.startsWith("!")) {
            if (!rtn.includeForce) {
                rtn.includeForce = {};
            }
            if (partStr.length > 1) {
                rtn.includeForce[partStr.substr(1)] = true;
            }
        }
        else {
            if (!rtn.include) {
                rtn.include = {};
            }
            rtn.include[partStr] = true;
        }
    }
    return rtn;
}

function parseSingleAutofire(amVal : string) : AutoFireExpr {
    if (amVal === "1") {
        return {source: "self", dest: "self", include: {"all": true}};
    }
    let [source, dest, parts] = splitAmVal(amVal);
    if (source == null) {
        return null;
    }
    let rtn : AutoFireExpr = {source: source, dest: dest, include: {}};
    for (let i=0; i<parts.length; i++) {
        let partStr = parts[i].toLowerCase();
        rtn.include[partStr] = true;
    }
    return rtn;
}

function parseAutoMerge(amAttr : string) : AutoMergeExpr[] {
    if (amAttr == null) {
        return null;
    }
    if (amAttr === "" || amAttr === "1") {
        return [{source: "self", dest: "self", include: {"all": true}}];
    }
    let amVals = amAttr.split(",");
    let rtn : AutoMergeExpr[] = [];
    for (let i=0; i<amVals.length; i++) {
        let amVal = amVals[i].trim();
        let expr = parseSingleAutomerge(amVal);
        if (expr != null) {
            rtn.push(expr);
        }
    }
    return rtn;
}

function parseAutoFire(amAttr : string) : AutoFireExpr[] {
    if (amAttr == null) {
        return null;
    }
    if (amAttr === "" || amAttr === "1") {
        return [{source: "self", dest: "self", include: {"all": true}}];
    }
    let amVals = amAttr.split(",");
    let rtn : AutoFireExpr[] = [];
    for (let i=0; i<amVals.length; i++) {
        let amVal = amVals[i].trim();
        let expr = parseSingleAutofire(amVal);
        if (expr != null) {
            rtn.push(expr);
        }
    }
    return rtn;
}

function escapeBrackets(text : string) {
    let lbpos = text.indexOf("{\\{");
    let rbpos = text.indexOf("}\\}");
    if (lbpos !== -1) {
        text = text.replace(/{(\\{)+/g, (t) => {
            return t.replace(/\\/g, "");
        });
    }
    if (rbpos !== -1) {
        text = text.replace(/}(\\})+/g, (t) => {
            return t.replace(/\\/g, "");
        });
    }
    return text;
}

class HtmlParser {
    opts : HtmlParserOpts;

    constructor(opts : HtmlParserOpts) {
        this.opts = opts ?? {};
    }
    
    parseStyle(node : HibikiNode, styleAttrName : string, styleAttr : string, pctx : ParseContext) : Record<string, NodeAttrType> {
        let rtn : Record<string, NodeAttrType> = {};
        if (styleAttr == null) {
            return rtn;
        }
        styleAttr = styleAttr.trim();
        if (styleAttr === "") {
            return rtn;
        }
        let parts = styleAttr.split(";");
        for (let part of parts) {
            part = part.trim();
            if (part === "") {
                continue;
            }
            let cpos = part.indexOf(":");
            let styleKey : string, styleVal : string;
            if (cpos === -1) {
                styleKey = part;
                styleVal = "1";
            }
            else {
                styleKey = part.substr(0, cpos);
                styleVal = part.substr(cpos+1);
            }
            if (styleKey === "") {
                continue;
            }
            let initialHypen = styleKey.startsWith("-");
            let initialMs = styleKey.startsWith("-ms-");
            styleKey = camelCase(styleKey.trim());
            if (initialHypen && !initialMs) {
                styleKey = styleKey[0].toUpperCase() + styleKey.substr(1);
            }
            styleVal = styleVal.trim();
            let styleExpr = this.parseExpr(node, styleKey, styleVal, styleAttrName, pctx);
            if (styleExpr != null) {
                rtn[styleKey] = styleExpr;
            }
        }
        return rtn;
    }

    parseText(parentTag : string, text : string, pctx : ParseContext) : HibikiNode | HibikiNode[] {
        if (text == null || text === "") {
            return null;
        }
        if (this.opts.noInlineText
            || parentTag === "script" || parentTag === "define-handler" || parentTag.startsWith("hibiki-")) {
            return new HibikiNode("#text", {text: text});
        }
        if (text.indexOf("{{") === -1) {
            return new HibikiNode("#text", {text: escapeBrackets(text)});
        }
        let textParts = parseDelimitedSections(text, "{{", "}}");
        let parts : HibikiNode[] = textParts.map((part) => {
            if (part.parttype === "plain") {
                let tval = escapeBrackets(part.text);
                return new HibikiNode("#text", {text: tval});
            }
            else {
                let tval = part.text.trim();
                let node : HibikiNode = new HibikiNode("h-text", {attrs: {}});
                this.parseStandardAttr(node, "bind", tval, pctx);
                this.parseStandardAttr(node, "inline", "1", pctx);
                return node;
            }
        });
        return parts;
    }

    parseStyleAttr(node : HibikiNode, name : string, value : string, pctx : ParseContext) : boolean {
        if (name === "style") {
            let styleMap = this.parseStyle(node, name, value, pctx);
            node.style = styleMap;
            return true;
        }
        else if (name.endsWith(":style")) {
            node.morestyles = node.morestyles || {};
            node.morestyles[name] = this.parseStyle(node, name, value, pctx);
            return true;
        }
        return false;
    }

    parseHandlerAttr(node : HibikiNode, name : string, value : string, pctx : ParseContext) : boolean {
        if (!name.endsWith(".handler")) {
            return false;
        }
        let handlerName = name.substr(0, name.length-8);
        if (node.handlers == null) {
            node.handlers = {};
        }
        let blockStr = value + ";";
        try {
            let actions : HAction[] = doParse(blockStr, "ext_statementBlock");
            node.handlers[handlerName] = actions;
        }
        catch (e) {
            console.log(sprintf("ERROR evaluating '%s' in <%s>\n\"%s\"\n", name, node.tag, value), e.toString());
        }
        return true;
    }

    parseCCAttr(node : HibikiNode, name : string, value : string, pctx : ParseContext) : boolean {
        if (!name.startsWith("cc:")) {
            return false;
        }
        if (name.length === 3) {
            return true;
        }
        let baseName = name.substr(3);
        let newName = "";
        for (let i=0; i<baseName.length; i++) {
            if (baseName[i] === "_") {
                if (i+1 == baseName.length) {
                    continue;
                }
                let nextCh = baseName[i+1];
                newName = newName + nextCh.toUpperCase();
                i++;
            }
            else {
                newName = newName + baseName[i];
            }
        }
        this.parseStandardAttr(node, newName, value, pctx);
        return true;
    }

    parseBindPathAttr(node : HibikiNode, name : string, value : string, pctx : ParseContext) : boolean {
        if (!name.endsWith(".bindpath")) {
            return false;
        }
        let baseName = attrBaseName(name.substr(0, name.length-9));
        if (baseName === "") {
            console.log(sprintf("WARNING Invalid bindpath attribute, cannot end with ':', cannot bind %s, ignoring", name));
            return true;
        }
        if (NON_BINDABLE_ATTRS[baseName] || name.startsWith("class.")) {
            console.log(sprintf("WARNING Invalid bindpath attribute, cannot bind %s, ignoring", name));
            return true;
        }
        if (value.trim() === "") {
            return true;
        }
        try {
            let lvExpr : HExpr = doParse(value, "ext_refAttribute");
            lvExpr.sourcestr = value;
            let bindName = name.substr(0, name.length-9);
            if (node.attrs == null) {
                node.attrs = {};
            }
            node.attrs[bindName] = lvExpr;
        }
        catch (e) {
            console.log(sprintf("ERROR evaluating '%s' in <%s>\n\"%s\"\n", name, node.tag, value), e.toString());
        }
        return true;
    }

    parseExpr(node : HibikiNode, name : string, value : string, styleAttrName : string, pctx : ParseContext) : NodeAttrType {
        let isParsed = (styleAttrName == null) && PARSED_ATTRS[name];
        if (!isParsed && (!value.startsWith("*") || value === "*" || value === "**")) {
            return value;
        }
        let exprStr = (isParsed ? value : value.substr(1).trim());
        try {
            let exprAst : HExpr = doParse(exprStr, "ext_fullExpr");
            exprAst.sourcestr = value;
            return exprAst;
        }
        catch (e) {
            if (styleAttrName != null) {
                console.log(sprintf("ERROR evaluating style property '%s' in <%s>@%s\n\"%s\"\n", name, node.tag, styleAttrName, exprStr), e.toString());
            }
            else {
                console.log(sprintf("ERROR evaluating attribute <%s>@%s\n\"%s\"\n", node.tag, name, exprStr), e.toString());
            }
            return null;
        }
    }

    parseCaptureHtmlAttrs(htmlElem : Element, node : HibikiNode, attrName : string, attrValue : string, pctx : ParseContext) : boolean {
        if (attrName == "innerhtml") {
            node.innerhtml = htmlElem.innerHTML;
            return true;
        }
        if (attrName == "outerhtml") {
            node.outerhtml = htmlElem.outerHTML;
            return true;
        }
        return false;
    }

    parseRawTagAttr(node : HibikiNode, attrName : string, attrValue : string, pctx : ParseContext) : boolean {
        if (node.tag === "define-component" || node.tag === "define-handler" || node.tag === "import-library" || node.tag === "define-vars" || node.tag.startsWith("hibiki-")) {
            if (attrValue === "") {
                attrValue = "1";
            }
            node.attrs[attrName] = attrValue;
            return true;
        }
        return false;
    }

    parseMarkAttr(node : HibikiNode, attrName : string, attrValue : string) : boolean {
        if (attrName == "hibiki-mark") {
            node.mark = true;
            return true;
        }
        return false;
    }

    parseAutoAttrs(node : HibikiNode, attrName : string, attrValue : string, pctx : ParseContext) {
        if (attrValue === "") {
            attrValue = "1";
        }
        if (attrName == "automerge") {
            node.automerge = parseAutoMerge(attrValue);
        }
        if (attrName == "autofire") {
            node.autofire = parseAutoFire(attrValue);
        }
    }

    parseForeachAttr(node : HibikiNode, attrName : string, attrValue : string, pctx : ParseContext) {
        try {
            let iterExprAst : HIteratorExpr = doParse(attrValue, "ext_iteratorExpr");
            iterExprAst.sourcestr = attrValue;
            node.foreachAttr = iterExprAst;
        }
        catch (e) {
            console.log(sprintf("ERROR evaluating foreach attribute <%s>@%s\n\"%s\"\n", node.tag, attrName, attrValue), e.toString());
        }
    }

    parseStandardAttr(node : HibikiNode, name : string, value : string, pctx : ParseContext) {
        if (value === "" && name !== "value") {
            value = "1";
        }
        let attrExpr = this.parseExpr(node, name, value, null, pctx);
        if (attrExpr == null) {
            return;
        }
        node.attrs[name] = attrExpr;
    }

    parseContextVars(ctxStr : string, htmlContext : string) : ContextVarType[] {
        if (ctxStr == null || ctxStr.trim() === "") {
            return null;
        }
        try {
            let actions : ContextVarType[] = doParse(ctxStr, "ext_contextAssignList");
            return actions;
        }
        catch (e) {
            console.log(sprintf("ERROR parsing %s (only simple assignments allowed)\n<<<\n%s\n>>>\n", htmlContext, ctxStr), e.toString());
            return null;
        }
    }

    parseHandlerText(node : HibikiNode) {
        let nameAttr = rawAttrFromNode(node, "name");
        let handlerText = textContent(node);
        if (handlerText.trim() === "") {
            return;
        }
        try {
            let block : HAction[] = doParse(handlerText + ";", "ext_statementBlock");
            if (node.handlers == null) {
                node.handlers = {};
            }
            node.handlers["handler"] = block;
        }
        catch (e) {
            console.log(sprintf("ERROR parsing define-handler name=%s\n<<<\n%s\n>>>\n", nameAttr, handlerText), e.toString());
        }
    }

    parseHtmlNode(parentTag : string, htmlNode : Node, pctx : ParseContext) : HibikiNode | HibikiNode[] {
        if (htmlNode.nodeType === 3 || htmlNode.nodeType === 4) {  // TEXT_NODE, CDATA_SECTION_NODE
            return this.parseText(parentTag, htmlNode.textContent, pctx);
        }
        if (htmlNode.nodeType === 8) { // COMMENT_NODE
            return new HibikiNode("#comment", {text: htmlNode.textContent});
        }
        if (htmlNode.nodeType !== 1) { // ELEMENT_NODE
            return null;
        }
        let htmlElem : Element = htmlNode as Element;
        let tagName = (htmlNode as Element).tagName.toLowerCase();
        pctx.tagStack.push(sprintf("<%s>", tagName));
        let node : HibikiNode = new HibikiNode(tagName);
        let nodeAttrs = (htmlNode as Element).attributes;
        if (nodeAttrs.length > 0) {
            node.attrs = {};
        }
        for (let i=0; i<nodeAttrs.length; i++) {
            let attr = nodeAttrs.item(i);
            let attrName = attr.name.toLowerCase();
            let attrValue = attr.value;
            if (this.parseCaptureHtmlAttrs(htmlElem, node, attrName, attrValue, pctx)) {
                continue;
            }
            if (this.parseRawTagAttr(node, attrName, attrValue, pctx)) {
                continue;
            }
            if (this.parseMarkAttr(node, attrName, attrValue)) {
                continue;
            }
            if (this.parseStyleAttr(node, attrName, attrValue, pctx)) {
                continue;
            }
            else if (this.parseHandlerAttr(node, attrName, attrValue, pctx)) {
                continue;
            }
            else if (this.parseBindPathAttr(node, attrName, attrValue, pctx)) {
                continue;
            }
            else if (this.parseCCAttr(node, attrName, attrValue, pctx)) {
                continue;
            }
            else if (attrName == "automerge" || attrName == "autofire") {
                this.parseAutoAttrs(node, attrName, attrValue, pctx);
                continue;
            }
            else if (attrName == "foreach") {
                this.parseForeachAttr(node, attrName, attrValue, pctx);
                continue;
            }
            this.parseStandardAttr(node, attrName, attrValue, pctx);
        }
        let list = this.parseNodeChildren(node.tag, htmlNode, pctx);
        if (list != null) {
            node.list = list;
        }
        if (node.tag === "script" && node.attrs != null && (node.attrs["type"] === "application/json" || node.attrs["type"] === "text/plain") && node.list != null && node.list.length === 1 && node.list[0].tag === "#text") {
            pctx.tagStack.pop();
            return node.list[0];
        }
        if (node.tag === "define-handler") {
            this.parseHandlerText(node);
        }

        // contextVars
        if (node.tag === "define-vars") {
            let textFrom = "<define-vars datacontext>";
            let ctxStr = rawAttrFromNode(node, "datacontext");
            if (ctxStr == null) {
                textFrom = "<define-vars>:text";
                ctxStr = textContent(node);
            }
            node.contextVars = this.parseContextVars(ctxStr, textFrom);
        }
        else if (node.tag === "define-component") {
            let ctxStr = rawAttrFromNode(node, "componentdata");
            if (ctxStr != null) {
                node.contextVars = this.parseContextVars(ctxStr, nodeStr(node) + ":componentdata");
            }
        }
        else if (rawAttrFromNode(node, "datacontext") != null) {
            let ctxStr = rawAttrFromNode(node, "datacontext");
            node.contextVars = this.parseContextVars(ctxStr, nodeStr(node) + ":datacontext");
        }
        pctx.tagStack.pop();
        return node;
    }

    parseNodeChildren(parentTag : string, htmlNode : Node, pctx : ParseContext) : HibikiNode[] {
        let nodeChildren = htmlNode.childNodes;
        if (nodeChildren.length === 0) {
            return null;
        }
        let rtn = [];
        for (let i=0; i<nodeChildren.length; i++) {
            let htmlNode = nodeChildren[i];
            let hnode = this.parseHtmlNode(parentTag, htmlNode, pctx);
            if (hnode == null) {
                continue;
            }
            else if (Array.isArray(hnode)) {
                rtn.push(...hnode);
            }
            else {
                rtn.push(hnode);
            }
        }
        return rtn;
    }

    parseHtml(input : string | HTMLElement, sourceName? : string) : HibikiNode {
        let elem = null;
        if (input instanceof HTMLElement) {
            elem = input;
        }
        else {
            elem = document.createElement("div");
            elem.innerHTML = input;
        }
        let pctx = {sourceName : sourceName, tagStack: []};
        let rootNode = (elem.tagName.toLowerCase() === "template" ? elem.content : elem);
        let rtn : HibikiNode = new HibikiNode("#def");
        rtn.list = this.parseNodeChildren(rtn.tag, rootNode, pctx) ?? [];
        return rtn;
    }
}

function parseHtml(input : string | HTMLElement, sourceName? : string, opts? : HtmlParserOpts) : HibikiNode {
    if (input == null) {
        return null;
    }
    if (opts == null) {
        if ((window as any).HibikiParserOpts != null) {
            opts = (window as any).HibikiParserOpts;
        }
    }
    opts = opts ?? {};
    let parser = new HtmlParser(opts);
    return parser.parseHtml(input, sourceName);
}

function parseDelimitedSections(text : string, openDelim : string, closeDelim : string) : {parttype : "plain"|"delim", text : string}[] {
    let parts : {parttype : "plain"|"delim", text : string}[] = [];
    if (text == null) {
        return parts;
    }
    let textPos = 0;
    let iters = 0;
    while (textPos < text.length) {
        let startPos = text.indexOf(openDelim, textPos);
        let endPos = -1;
        if (startPos !== -1) {
            endPos = text.indexOf(closeDelim, startPos + openDelim.length);
        }
        if (startPos === -1 || endPos === -1) {
            let tval = text.substr(textPos);
            parts.push({parttype: "plain", text: tval});
            break;
        }
        if (startPos > textPos) {
            let tval = text.substr(textPos, startPos-textPos);
            parts.push({parttype: "plain", text: tval});
        }
        let bindText = text.substr(startPos+openDelim.length, endPos-startPos-openDelim.length);
        parts.push({parttype: "delim", text: bindText});
        textPos = endPos+closeDelim.length;
    }
    return parts;
}

export {parseHtml, parseDelimitedSections, HibikiNode};

export type {NodeAttrType};
