// Copyright 2021 Dashborg Inc

import camelCase from "camelcase";
import type {HibikiNode, HtmlParserOpts, PathType, AutoMergeExpr, AutoFireExpr, NodeAttrType} from "./types";
import merge from "lodash/merge";
import {sprintf} from "sprintf-js";
import {doParse} from "./hibiki-parser";
import type {HAction, HExpr, HIteratorExpr} from "./datactx";
import {textContent, rawAttrFromNode} from "./utils";

const styleAttrPartRe = new RegExp("^(style(?:-[a-z][a-z0-9-])?)\\.(.*)");

const PARSED_ATTRS = {
    "bind": true,
    "if": true,
    "foreach": true,
    "condition": true,
    "automerge": true,
};

type ParseContext = {
    sourceName : string,
    tagStack : string[],
}

// returns [source, dest, parts]
function splitAmVal(amVal : string) : [string, string, string[]] {
    let match = amVal.match(/^(?:([a-zA-Z0-9]+)(?:=>([a-zA-Z0-9]+))?)?(?:@(.*))?$/);
    if (match == null) {
        return null;
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
        rtn.push(parseSingleAutomerge(amVal));
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
        rtn.push(parseSingleAutofire(amVal));
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
            return {tag: "#text", text: text};
        }
        if (text.indexOf("{{") === -1) {
            return {tag: "#text", text: escapeBrackets(text)};
        }
        let textParts = parseDelimitedSections(text, "{{", "}}");
        let parts : HibikiNode[] = textParts.map((part) => {
            if (part.parttype === "plain") {
                let tval = escapeBrackets(part.text);
                return {tag: "#text", text: tval};
            }
            else {
                let tval = part.text.trim();
                let node : HibikiNode = {tag: "h-text", attrs: {}};
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
            let block : HAction[] = doParse(blockStr, "ext_statementBlock");
            node.handlers[handlerName] = block;
        }
        catch (e) {
            console.log(sprintf("ERROR evaluating '%s' in <%s>\n\"%s\"\n", name, node.tag, value), e.toString());
        }
        return true;
    }

    parseBindPathAttr(node : HibikiNode, name : string, value : string, pctx : ParseContext) : boolean {
        if (!name.endsWith(".bindpath")) {
            return false;
        }
        if (value.trim() === "") {
            return true;
        }
        try {
            let path : HExpr = doParse(value, "ext_fullPathExpr");
            path.sourcestr = value;
            if (node.bindings == null) {
                node.bindings = {};
            }
            node.bindings[name.substr(0, name.length-9)] = path;
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

    parseRawTagAttr(node : HibikiNode, attrName : string, attrValue : string, pctx : ParseContext) : boolean {
        if (node.tag === "define-component" || node.tag === "define-handler" || node.tag === "import-library" || node.tag === "define-vars" || node.tag.startsWith("hibiki-")) {
            node.attrs[attrName] = attrValue;
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
            let node = {tag: "#comment", text: htmlNode.textContent};
            return node;
        }
        if (htmlNode.nodeType !== 1) { // ELEMENT_NODE
            return null;
        }
        let tagName = (htmlNode as Element).tagName.toLowerCase();
        pctx.tagStack.push(sprintf("<%s>", tagName));
        let node : HibikiNode = {tag: tagName};
        let nodeAttrs = (htmlNode as Element).attributes;
        if (nodeAttrs.length > 0) {
            node.attrs = {};
        }
        for (let i=0; i<nodeAttrs.length; i++) {
            let attr = nodeAttrs.item(i);
            let attrName = attr.name.toLowerCase();
            let attrValue = attr.value;
            if (this.parseRawTagAttr(node, attrName, attrValue, pctx)) {
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
        let rtn : HibikiNode = {tag: "#def", list: []};
        rtn.list = this.parseNodeChildren(rtn.tag, rootNode, pctx) || [];
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

export {parseHtml, parseDelimitedSections};
