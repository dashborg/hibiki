// Copyright 2021 Dashborg Inc

import camelCase from "camelcase";
import type {HibikiNode, HtmlParserOpts} from "./types";
import merge from "lodash/merge";

const styleAttrPartRe = new RegExp("^(style(?:-[a-z][a-z0-9-])?)\\.(.*)");

function escapeBrackets(text : string) {
    let lbpos = text.indexOf("{\\{");
    let rbpos = text.indexOf("}\\}");
    if (lbpos != -1) {
        text = text.replace(/{(\\{)+/g, (t) => {
            return t.replace(/\\/g, "");
        });
    }
    if (rbpos != -1) {
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
    
    parseStyleAttr(styleAttr : string) : Record<string, string> {
        let rtn : Record<string, string> = {};
        if (styleAttr == null) {
            return rtn;
        }
        styleAttr = styleAttr.trim();
        if (styleAttr == "") {
            return rtn;
        }
        let parts = styleAttr.split(";");
        for (let part of parts) {
            part = part.trim();
            if (part == "") {
                continue;
            }
            let cpos = part.indexOf(":");
            let styleKey : string, styleVal : string;
            if (cpos == -1) {
                styleKey = part;
                styleVal = "1";
            }
            else {
                styleKey = part.substr(0, cpos);
                styleVal = part.substr(cpos+1);
            }
            if (styleKey == "") {
                continue;
            }
            let initialHypen = styleKey.startsWith("-");
            let initialMs = styleKey.startsWith("-ms-");
            styleKey = camelCase(styleKey.trim());
            if (initialHypen && !initialMs) {
                styleKey = styleKey[0].toUpperCase() + styleKey.substr(1);
            }
            styleVal = styleVal.trim();
            rtn[styleKey] = styleVal;
        }
        return rtn;
    }

    parseText(parentTag : string, text : string) : HibikiNode | HibikiNode[] {
        if (text == null || text == "") {
            return null;
        }
        if (this.opts.noInlineText || parentTag == "script" || parentTag == "define-handler") {
            return {tag: "#text", text: text};
        }
        if (text.indexOf("{{") == -1) {
            return {tag: "#text", text: escapeBrackets(text)};
        }
        let textParts = parseDelimitedSections(text, "{{", "}}");
        let parts : HibikiNode[] = textParts.map((part) => {
            if (part.parttype == "plain") {
                let tval = escapeBrackets(part.text);
                return {tag: "#text", text: tval};
            }
            else {
                let tval = part.text.trim();
                return {tag: "h-text", attrs: {bind: tval}};
            }
        });
        return parts;
    }

    parseHtmlNode(parentTag : string, htmlNode : Node) : HibikiNode | HibikiNode[] {
        if (htmlNode.nodeType == 3 || htmlNode.nodeType == 4) {  // TEXT_NODE, CDATA_SECTION_NODE
            return this.parseText(parentTag, htmlNode.textContent);
        }
        if (htmlNode.nodeType == 8) { // COMMENT_NODE
            let node = {tag: "#comment", text: htmlNode.textContent};
            return node;
        }
        if (htmlNode.nodeType != 1) { // ELEMENT_NODE
            return null;
        }
        let node : HibikiNode = {tag: (htmlNode as Element).tagName.toLowerCase()};
        let nodeAttrs = (htmlNode as Element).attributes;
        if (nodeAttrs.length > 0) {
            node.attrs = {};
        }
        for (let i=0; i<nodeAttrs.length; i++) {
            let attr = nodeAttrs.item(i);
            let value = attr.value;
            if (value == "" && attr.name != "value") {
                value = "1";
            }
            node.attrs[attr.name] = value;
            if (attr.name == "style") {
                let styleMap = this.parseStyleAttr(attr.value);
                node.style = styleMap;
            }
            if (attr.name.startsWith("style-")) {
                node.morestyles = node.morestyles || {};
                node.morestyles[attr.name] = this.parseStyleAttr(attr.value);
            }
        }
        let list = this.parseNodeChildren(node.tag, htmlNode);
        if (list != null) {
            node.list = list;
        }
        if (node.tag == "script" && node.attrs != null && (node.attrs["type"] == "application/json" || node.attrs["type"] == "text/plain") && node.list != null && node.list.length == 1 && node.list[0].tag == "#text") {
            return node.list[0];
        }
        return node;
    }

    parseNodeChildren(parentTag : string, htmlNode : Node) : HibikiNode[] {
        let nodeChildren = htmlNode.childNodes;
        if (nodeChildren.length == 0) {
            return null;
        }
        let rtn = [];
        for (let i=0; i<nodeChildren.length; i++) {
            let htmlNode = nodeChildren[i];
            let hnode = this.parseHtmlNode(parentTag, htmlNode);
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

    parseHtml(input : string | HTMLElement) : HibikiNode {
        let elem = null;
        if (input instanceof HTMLElement) {
            elem = input;
        }
        else {
            elem = document.createElement("div");
            elem.innerHTML = input;
        }
        let rootNode = (elem.tagName.toLowerCase() == "template" ? elem.content : elem);
        let rtn : HibikiNode = {tag: "#def", list: []};
        rtn.list = this.parseNodeChildren(rtn.tag, rootNode) || [];
        return rtn;
    }
}

function parseHtml(input : string | HTMLElement, opts? : HtmlParserOpts) : HibikiNode {
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
    return parser.parseHtml(input);
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
        if (startPos != -1) {
            endPos = text.indexOf(closeDelim, startPos + openDelim.length);
        }
        if (startPos == -1 || endPos == -1) {
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
