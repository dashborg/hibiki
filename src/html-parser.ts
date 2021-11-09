import camelCase from "camelcase";
import type {HibikiNode} from "./types";

const styleAttrPartRe = new RegExp("^(style(?:-[a-z][a-z0-9-])?)\\.(.*)");

function parseStyleAttr(styleAttr : string) : Record<string, string> {
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

function parseHtmlNode(htmlNode : Node) : HibikiNode {
    if (htmlNode.nodeType == 3 || htmlNode.nodeType == 4) {  // TEXT_NODE, CDATA_SECTION_NODE
        let node = {tag: "#text", text: htmlNode.textContent};
        return node;
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
        node.attrs[attr.name] = (attr.value == "" ? "1" : attr.value);
        if (attr.name == "style") {
            let styleMap = parseStyleAttr(attr.value);
            node.style = styleMap;
        }
        if (attr.name.startsWith("style-")) {
            node.morestyles = node.morestyles || {};
            node.morestyles[attr.name] = parseStyleAttr(attr.value);
        }
    }
    let list = parseNodeChildren(htmlNode);
    if (list != null) {
        node.list = list;
    }
    return node;
}

function parseNodeChildren(htmlNode : Node) : HibikiNode[] {
    let nodeChildren = htmlNode.childNodes;
    if (nodeChildren.length == 0) {
        return null;
    }
    let rtn = [];
    for (let i=0; i<nodeChildren.length; i++) {
        let htmlNode = nodeChildren[i];
        let hnode = parseHtmlNode(htmlNode);
        if (hnode != null) {
            rtn.push(hnode);
        }
    }
    return rtn;
}

function parseHtml(input : string | HTMLElement) : HibikiNode {
    let elem = null;
    if (input instanceof HTMLElement) {
        elem = input;
    }
    else {
        elem = document.createElement("div");
        elem.innerHTML = input;
    }
    let rootNode = (elem.tagName.toLowerCase() == "template" ? elem.content : elem);
    console.log(rootNode);
    let rtn : HibikiNode = {tag: "#def", list: []};
    rtn.list = parseNodeChildren(rootNode) || [];
    return rtn;
}

export {parseHtml};
