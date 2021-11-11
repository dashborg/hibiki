import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import * as cn from "classnames/dedupe";
import {sprintf} from "sprintf-js";
import debounce from "lodash/debounce";
import throttle from "lodash/throttle";
import {boundMethod} from 'autobind-decorator'
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import {v4 as uuidv4} from 'uuid';
import dayjs from "dayjs";
import dayjsDuration from "dayjs/plugin/duration";
import dayjsRelativeTime from "dayjs/plugin/relativeTime";
import dayjsUtc from "dayjs/plugin/utc";
import dayjsRelative from "dayjs/plugin/relativeTime";

import type {HibikiNode, ComponentType, LibraryType} from "./types";
import {DBCtx} from "./dbctx";
import * as DataCtx from "./datactx";
import {HibikiState, DataEnvironment, getAttributes, getAttribute, getStyleMap} from "./state";
import {valToString, valToInt, valToFloat, resolveNumber, isObject, textContent, SYM_PROXY, SYM_FLATTEN} from "./utils";
import {parseHtml} from "./html-parser";
import * as NodeUtils from "./nodeutils";
import {RtContext} from "./error";

declare var window : any;

dayjs.extend(dayjsDuration);
dayjs.extend(dayjsRelativeTime);
dayjs.extend(dayjsUtc)
dayjs.extend(dayjsRelativeTime);
window.dayjs = dayjs;

let welcomeMessage = false;
let usageFired = false;

@mobxReact.observer
class ErrorMsg extends React.Component<{message: string}, {}> {
    render() {
        return (
            <div className="ui negative message dashelem">
                <p>{this.props.message}</p>
            </div>
        );
    }
}

@mobxReact.observer
class HibikiRootNode extends React.Component<{page : string, dataenv : DataEnvironment}, {}> {
    renderingDBState : HibikiState;
    loadUuid : string;

    constructor(props : any) {
        super(props);
    }
    
    queueOnLoadCheck() {
        if (this.renderingDBState == null || this.renderingDBState.HasRendered) {
            return;
        }
        if (!window.HibikiLoaded) {
            window.HibikiLoaded = {};
        }
        this.loadUuid = uuidv4();
        let runJS = "window.HibikiLoaded['" + this.loadUuid + "'] = true;";
        this.props.dataenv.dbstate.queueScriptText(runJS, true);
        setTimeout(() => this.checkLoaded(1), 100);
    }

    checkLoaded(iterNum : number) {
        // console.log("check loaded", iterNum, window["HibikiLoaded"], window.d3);
        if (!window.HibikiLoaded[this.loadUuid]) {
            if (iterNum > 100) {
                console.log("Script Queue Never finished after 10s (Panel checkLoaded)");
            }
            else {
                setTimeout(() => this.checkLoaded(iterNum+1), 100);
                return;
            }
        }
        let node = this.getHibikiNode();
        let ctx = new DBCtx(this as any, node);
        setTimeout(() => ctx.dataenv.dbstate.fireScriptsLoaded(), 1);
        ctx.handleOnX("onloadhandler");
    }

    componentDidMount() {
        this.queueOnLoadCheck();
        let flowerEmoji = String.fromCodePoint(0x1F338);
        if (this.props.dataenv.dbstate.allowUsageImg() && !usageFired) {
            usageFired = true;
            let usageImg = new Image();
            usageImg.src = "https://static.dashborg.net/static/hibiki-usage.gif";
            usageImg.onload = function() {};
        }
        if (this.props.dataenv.dbstate.allowWelcomeMessage() && !welcomeMessage) {
            welcomeMessage = true;
            console.log(flowerEmoji + " Hibiki HTML https://github.com/dashborg/hibiki | Developed by Dashborg Inc https://dashborg.net");
        }
    }

    componentDidUpdate() {
        this.queueOnLoadCheck();
    }

    getHibikiNode() : HibikiNode {
        return this.props.dataenv.dbstate.findPage(this.props.page);
    }
    
    render() {
        let node = this.getHibikiNode();
        let ctx = new DBCtx(this as any, node);
        let rootClasses = "";
        if (ctx.dataenv.dbstate.Ui == "dashborg") {
            rootClasses += "rootdiv dashelem col";
        }
        let cnMap = ctx.resolveCnMap("class", rootClasses);
        let style = ctx.resolveStyleMap("style");
        this.renderingDBState = ctx.dataenv.dbstate;
        return (
            <div style={style} className={cn(cnMap)}>
                <NodeList list={ctx.node.list} ctx={ctx}/>
            </div>
        );
    }
}

function ctxRenderHtmlChildren(ctx : DBCtx, dataenv? : DataEnvironment) : Element[] {
    if (dataenv == null) {
        dataenv = ctx.childDataenv;
    }
    return baseRenderHtmlChildren(ctx.node.list, dataenv);
}

function renderHtmlChildren(node : {list? : HibikiNode[]}, dataenv : DataEnvironment) : Element[] {
    return baseRenderHtmlChildren(node.list, dataenv);
}

function baseRenderHtmlChildren(list : HibikiNode[], dataenv : DataEnvironment) : Element[] {
    let rtn : any[] = [];
    if (list == null || list.length == 0) {
        return null;
    }
    for (let child of list) {
        if (child.tag == "#text") {
            rtn.push(child.text);
        }
        else if (child.tag == "#comment") {
            continue;
        }
        else if (NodeUtils.BLOCKED_ELEMS[child.tag]) {
            continue;
        }
        else if (child.tag == "if-break") {
            // withcontext?
            let ifBreakCtx = new DBCtx(null, child, dataenv);
            let condition = true;
            let cattr = ifBreakCtx.resolveAttr("condition");
            if (cattr != null) {
                let conditionVal = ifBreakCtx.evalExpr(cattr);
                condition = !!conditionVal;
            }
            if (!condition) {
                continue;
            }
            rtn.push(<HtmlNode node={child} dataenv={dataenv}/>);
            break;
        }
        else if (child.tag == "define-vars") {
            let setCtx = new DBCtx(null, child, dataenv);
            let contextAttr = setCtx.resolveAttr("context");
            if (contextAttr == null) {
                rtn.push(<ErrorMsg message="<define-vars> no context attribute"/>);
                continue;
            }
            try {
                let ctxDataenv = DataCtx.ParseAndCreateContextThrow(contextAttr, dataenv, "<define-vars>");
                dataenv = ctxDataenv;
            }
            catch (e) {
                rtn.push(<ErrorMsg message={"<define-vars> Error parsing/executing context block: " + e}/>);
            }
            continue;
        }
        else if (child.tag == "define-handler") {
            let attrs = child.attrs || {};
            if (attrs.name == null || attrs.name == "") {
                rtn.push(<ErrorMsg message={"<define-handler> no name attribute"}/>);
                continue;
            }
            let handlerStr = textContent(child);
            dataenv.handlers[attrs.name] = {handlerStr: handlerStr, parentEnv: false};
            continue;
        }
        else {
            rtn.push(<HtmlNode node={child} dataenv={dataenv}/>);
        }
    }
    return rtn;
}

@mobxReact.observer
class NodeList extends React.Component<{list : HibikiNode[], ctx : DBCtx}> {
    render() {
        let {list, ctx} = this.props;
        let rtn = baseRenderHtmlChildren(list, ctx.childDataenv);
        if (rtn == null) {
            return null;
        }
        return <React.Fragment>{rtn}</React.Fragment>;
    }
}

@mobxReact.observer
class HtmlNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    nodeType : string = "unknown";
    
    renderInner(ctx : DBCtx) : any {
        let node = ctx.node;
        let nodeName = node.tag;
        if (nodeName.startsWith("hibiki-")) {
            return null;
        }
        if (!ctx.isEditMode() && ctx.hasAttr("if")) {
            let ifText = ctx.resolveAttr("if");
            let ifExpr = ctx.evalExpr(ifText);
            if (!ifExpr) {
                return null;
            }
        }
        let dataenv = this.props.dataenv;
        let dbstate = dataenv.dbstate;
        let component = dbstate.ComponentLibrary.findComponent(node.tag);
        if (component != null) {
            if (component.componentType == "react-custom") {
                this.nodeType = "custom-react";
                return <CustomReactNode component={component} node={node} dataenv={dataenv}/>;
            }
            else if (component.componentType == "hibiki-native") {
                this.nodeType = "component";
                return <component.impl node={node} dataenv={dataenv}/>;
            }
            else if (component.componentType == "hibiki-html") {
                this.nodeType = "html-component";
                return <CustomNode component={component} node={node} dataenv={dataenv}/>;
            }
            else {
                this.nodeType = "unknown";
                return <div>&lt;{nodeName}&gt;</div>;
            }
        }
        if (nodeName.startsWith("html-") || nodeName.indexOf("-") == -1) {
            this.nodeType = "rawhtml";
            return <RawHtmlNode node={node} dataenv={dataenv}/>
        }
        this.nodeType = "unknown";
        return <div>&lt;{nodeName}&gt;</div>;
    }

    render() {
        let ctx = new DBCtx(this);
        let content = this.renderInner(ctx)
        return content;
    }
}

@mobxReact.observer
class CustomReactNode extends React.Component<{node : HibikiNode, component : ComponentType, dataenv : DataEnvironment}, {}> {
    render() {
        let ctx = new DBCtx(this);
        let dataenv = ctx.dataenv;
        let component = this.props.component;
        let implBox = component.reactimpl;
        let reactImpl = implBox.get();
        if (reactImpl == null) {
            return null;
        }
        let attrs = ctx.resolveAttrs({raw: true});
        let nodeVar = NodeUtils.makeNodeVar(ctx);
        let childEnv = ctx.childDataenv.makeSpecialChildEnv({node: nodeVar});
        childEnv.htmlContext = "react " + ctx.node.tag;
        let rtnElems = renderHtmlChildren(ctx.node, childEnv)
        let reactElem = React.createElement(reactImpl, attrs, rtnElems);
        return reactElem;
    }
}

@mobxReact.observer
class RawHtmlNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    constructor(props : any) {
        super(props);
        let ctx = new DBCtx(this);
        if (!ctx.isEditMode()) {
            if (NodeUtils.GETVALUE_ELEMS[ctx.getTagName()]) {
                ctx.setDefaultForData("value");
            }
        }
    }

    componentDidMount() {
        let ctx = new DBCtx(this);
        if (!ctx.isEditMode()) {
            ctx.dataenv.dbstate.queuePostScriptRunFn(() => ctx.handleOnX("onmounthandler"));
        }
    }
    
    @boundMethod handleBindValueOnChange(e) {
        let ctx = new DBCtx(this);
        if (ctx.isEditMode()) {
            return;
        }
        let isReadOnly = !!ctx.resolveAttr("readonly");
        let isOnChangeElem = NodeUtils.ONCHANGE_ELEMS[ctx.getTagName()];
        let typeAttr = ctx.resolveAttr("type");
        let isCheckbox = (ctx.getTagName() == "input" && typeAttr == "checkbox");
        let valueLV = ctx.resolveData("value", true);
        let outputValue = null;
        if (isCheckbox) {
            if (isReadOnly) {
                // checkbox is a special onchangeelem
                ctx.handleOnChange(e.target.checked);
                return;
            }
            outputValue = e.target.checked;
            valueLV.set(outputValue);
        }
        else {
            outputValue = e.target.value;
            NodeUtils.handleConvertType(ctx, outputValue);
            if (isReadOnly) {
                if (isOnChangeElem) {
                    ctx.handleOnChange(outputValue);
                }
                return;
            }
            valueLV.set(outputValue);
            ctx.handleOnChange(outputValue);
        }
        return;
    }
    
    render() {
        let ctx = new DBCtx(this);
        let tagName = ctx.getTagName();
        let elemProps : any = {};
        let attrs = ctx.resolveAttrs();
        let style = ctx.resolveStyleMap("style");
        let cnMap = ctx.resolveCnMap("class");
        let automergeAttrs = {
            style: style,
            cnMap: cnMap,
            disabled: null,
        };
        if (attrs.automerge != null) { // ?? TODO
            let automergeArr = NodeUtils.parseAutomerge(attrs.automerge);
            for (let i=0; i<automergeArr.length; i++) {
                let amParams = automergeArr[i];
                NodeUtils.automerge(ctx, automergeAttrs, amParams.name, amParams.opts);
            }
        }
        
        let typeAttr = attrs["type"];
        for (let [k,v] of Object.entries(attrs)) {
            if (k == "style" || k == "class" || k == "if" || k == "notif" || k == "localdata" || k == "eid" || k == "disabled") {
                continue;
            }
            if (!ctx.isEditMode()) {
                if (k == "onclickhandler") {
                    elemProps.onClick = ctx.handleOnClick;
                    if (tagName == "a" && elemProps["href"] == null) {
                        elemProps["href"] = "#";
                    }
                }
                if (NodeUtils.BINDVALUE_ONCHANGE_ELEMS[tagName]) {
                    elemProps.onChange = this.handleBindValueOnChange;
                }
                if (k == "handler" && NodeUtils.HANDLER_ELEMS[tagName]) {
                    elemProps[NodeUtils.HANDLER_ELEMS[tagName]] = ctx.runHandler;
                    if (tagName == "a" && elemProps["href"] == null) {
                        elemProps["href"] = "#";
                    }
                }
                if (k == "onsubmithandler" && NodeUtils.SUBMIT_ELEMS[tagName]) {
                    elemProps.onSubmit = ctx.handleOnSubmit;
                }
            }
            if (k.startsWith("on")) {
                continue;
            }
            if (!ctx.isEditMode() && k == "blobsrc") {
                if (v == null) {
                    continue;
                }
                if (!(v instanceof DataCtx.HibikiBlob)) {
                    console.log("Invalid blobsrc attribute, not a Blob object");
                    continue;
                }
                if (tagName == "link") {
                    elemProps.href = v.makeDataUrl();
                }
                else {
                    elemProps.src = v.makeDataUrl();
                }
                continue;
            }
            if (!ctx.isEditMode() && k == "pathsrc") {
                if (v == null || typeof(v) != "string" || !v.startsWith("/")) {
                    continue;
                }
                if (tagName == "link") {
                    elemProps.href = "/@raw" + v;
                }
                else {
                    elemProps.src = "/@raw" + v;
                }
                continue;
            }
            if ((k == "value" || k == "defaultvalue") && NodeUtils.GETVALUE_ELEMS[tagName]) {
                continue;
            }
            if (k == "download" && v == "1") {
                elemProps["download"] = "";
                continue;
            }
            elemProps[k] = v;
        }
        if (!ctx.isEditMode() && NodeUtils.GETVALUE_ELEMS[tagName]) {
            let isCheckbox = (tagName == "input" && typeAttr == "checkbox");
            let valueLV = ctx.resolveData("value", true);
            let value = DataCtx.demobx(valueLV.get());
            if (isCheckbox) {
                elemProps["checked"] = !!value;
            }
            else {
                if (value == null) {
                    value = "";
                }
                elemProps["value"] = value;
            }
        }
        if (tagName == "form" && !elemProps.onSubmit && attrs["action"] == null) {
            elemProps.onSubmit = ctx.handleOnSubmit;
        }
        if (Object.keys(automergeAttrs.style).length > 0) {
            elemProps["style"] = automergeAttrs.style;
        }
        if (Object.keys(automergeAttrs.cnMap).length > 0) {
            elemProps["className"] = cn(automergeAttrs.cnMap);
        }
        if (automergeAttrs.disabled != null) {
            elemProps["disabled"] = automergeAttrs.disabled;
        }
        let elemChildren = ctxRenderHtmlChildren(ctx);
        return React.createElement(tagName, elemProps, elemChildren);
    }
}

@mobxReact.observer
class CustomNode extends React.Component<{node : HibikiNode, component : ComponentType, dataenv : DataEnvironment}, {}> {
    constructor(props : any) {
        super(props);
        this.makeChildEnv(true);
    }
    
    makeChildEnv(initialize : boolean) : DataEnvironment {
        let ctx = new DBCtx(this);
        let component = this.props.component;
        let implNode = component.node;
        let rawImplAttrs = implNode.attrs || {};
        let nodeVar = NodeUtils.makeNodeVar(ctx);
        let childrenVar = NodeUtils.makeChildrenVar(ctx.dataenv, ctx.node);
        let argDecls = NodeUtils.parseArgsDecl(rawImplAttrs.args);
        let nodeDataBox = ctx.dataenv.dbstate.NodeDataMap.get(ctx.uuid);
        if (nodeDataBox == null) {
            let uuidName = "id_" + ctx.uuid.replace(/-/g, "_");
            nodeDataBox = mobx.observable.box({_hibiki: {"customtag": rawImplAttrs.name, uuid: ctx.uuid}}, {name: uuidName});
            ctx.dataenv.dbstate.NodeDataMap.set(ctx.uuid, nodeDataBox);
        }
        let nodeDataLV = new DataCtx.ObjectLValue(null, nodeDataBox);
        let specials : {[e:string] : any} = {};
        specials.children = childrenVar;
        specials.node = nodeVar;
        let resolvedAttrs = {};
        let handlers = {};
        let ctxAttrs = ctx.getRawAttrs();
        for (let key in rawImplAttrs) {
            let val = rawImplAttrs[key];
            if (key.endsWith("handler") && val != null && typeof(val) == "string") {
                handlers[key] = {handlerStr: val, parentEnv: false};
            }
        }
        for (let key in ctxAttrs) {
            let val = ctxAttrs[key];
            if (key.endsWith("handler") && val != null && typeof(val) == "string") {
                handlers[key] = {handlerStr: val, parentEnv: true};
            }
        }
        let crootProxy = componentRootProxy(nodeDataLV, resolvedAttrs);
        let childEnv = ctx.childDataenv.makeSpecialChildEnv(specials, {componentRoot: crootProxy, handlers: handlers});
        childEnv.htmlContext = "component " + ctx.node.tag;
        if (initialize && rawImplAttrs.defaults != null) {
            try {
                let block = DataCtx.ParseBlockThrow(rawImplAttrs.defaults);
                DataCtx.CreateContextThrow(block, childEnv, sprintf("<%s>:defaults", rawImplAttrs.name));
            }
            catch (e) {
                console.log(sprintf("ERROR parsing/executing 'defaults' in component %s", rawImplAttrs.name), e);
            }
        }
        for (let key in argDecls) {
            let resolvedAttr = ctx.resolveAttrData(key, argDecls[key]);
            if (resolvedAttr != null) {
                resolvedAttrs[key] = resolvedAttr;
            }
        }
        return childEnv;
    }

    componentDidMount() {
        let ctx = new DBCtx(this);
    }

    render() {
        let ctx = new DBCtx(this);
        let component = this.props.component;
        let implNode = component.node;
        let childEnv = this.makeChildEnv(false);
        let rtnElems = renderHtmlChildren(implNode, childEnv)
        if (implNode.attrs && implNode.attrs["dashelem"]) {
            return <DashElemNode ctx={ctx}>{rtnElems}</DashElemNode>
        }
        else {
            if (rtnElems == null) {
                return null;
            }
            return <React.Fragment>{rtnElems}</React.Fragment>
        }
    }
}

function componentRootProxy(nodeDataLV : DataCtx.ObjectLValue, resolvedAttrs : {[e : string] : any}) : {[e : string] : any} {
    let traps = {
        get: (obj : any, prop : string | symbol) : any => {
            if (prop == null) {
                return null;
            }
            if (prop == SYM_PROXY) {
                return true;
            }
            if (prop == SYM_FLATTEN) {
                let rtn = {};
                Object.assign(rtn, nodeDataLV.root.get());
                Object.assign(rtn, resolvedAttrs);
                return rtn;
            }
            if (prop in resolvedAttrs) {
                return resolvedAttrs[prop.toString()];
            }
            return nodeDataLV.subMapKey(prop.toString()).get();
        },
        set: (obj : any, prop : string, value : any) : boolean => {
            if (prop == null) {
                return true;
            }
            if (prop in resolvedAttrs) {
                let lv = resolvedAttrs[prop];
                if (lv instanceof DataCtx.LValue) {
                    if (lv == value) {
                        return true;
                    }
                    lv.set(value);
                    return true;
                }
                else {
                    console.log(sprintf("Cannot set component-data '%s', read-only attribute was passed", prop));
                    return true;
                }
            }
            nodeDataLV.subMapKey(prop).set(value);
            return true;
        },
    };
    return new Proxy({}, traps);
}

@mobxReact.observer
class TextNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    render() {
        return NodeUtils.renderTextData(this.props.node, this.props.dataenv);
    }
}

@mobxReact.observer
class IfNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    render() {
        let ctx = new DBCtx(this);
        let condition = true;
        let cattr = ctx.resolveAttr("condition");
        if (cattr != null) {
            let conditionVal = ctx.evalExpr(cattr);
            condition = !!conditionVal;
        }
        if (!condition) {
            return null;
        }
        return <NodeList list={ctx.node.list} ctx={ctx}/>;
    }
}

@mobxReact.observer
class ForEachNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    render() {
        // let {node, data, dbstate, attrs, bindattr, bindVal} = this.setup();
        let ctx = new DBCtx(this);
        let dataLV = ctx.resolveData("data", false);
        let rtnElems = [];
        let bindVal = dataLV.get();
        if (bindVal == null) {
            return null;
        }
        let [iterator, isMap] = NodeUtils.makeIterator(bindVal);
        let index = 0;
        for (let rawVal of iterator) {
            let ctxVars = {"index": index};
            let [key, val] = NodeUtils.getKV(rawVal, isMap);
            if (key != null) {
                ctxVars["key"] = key;
            }
            let childEnv = ctx.dataenv.makeChildEnv(val, ctxVars);
            let childElements = renderHtmlChildren(ctx.node, childEnv);
            if (childElements != null) {
                rtnElems.push(...childElements);
            }
            index++;
        }
        if (rtnElems.length == 0) {
            return null;
        }
        return (
            <React.Fragment>{rtnElems}</React.Fragment>
        );
    }
}

@mobxReact.observer
class ScriptNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    render() {
        let ctx = new DBCtx(this);
        let blobsrc = ctx.resolveAttr("blobsrc");
        let srcAttr = ctx.resolveAttr("src");
        let isSync = ctx.resolveAttr("sync")
        if (blobsrc == null && srcAttr == null) {
            let scriptText = textContent(ctx.node);
            if (scriptText == null || scriptText.trim() == "") {
                return null;
            }
            ctx.dataenv.dbstate.queueScriptText(scriptText, isSync);
            return null;
        }
        if (blobsrc != null) {
            srcAttr = blobsrc.makeDataUrl();
        }
        ctx.dataenv.dbstate.queueScriptSrc(srcAttr, isSync);
        return null;
    }
}

@mobxReact.observer
class DateFormatNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    render() {
        let ctx = new DBCtx(this);
        let dataLV = ctx.resolveData("data", false);
        let bindVal = DataCtx.demobx(dataLV.get());
        let modeAttr = ctx.resolveAttr("mode");
        let nulltext = ctx.resolveAttr("nulltext");
        let style = ctx.resolveStyleMap("style");
        if (typeof(bindVal) == "string" && modeAttr == "parse") {
            try {
                bindVal = parseFloat(dayjs(bindVal).format("x"));
            } catch (e) {
                return NodeUtils.renderTextSpan("invalid", style);
            }
        }
        let relativeAttr = !!ctx.resolveAttr("relative");
        let durationAttr = ctx.resolveAttr("duration");
        if (typeof(bindVal) == "string") {
            bindVal = parseFloat(bindVal);
        }
        if (bindVal == null) {
            return NodeUtils.renderTextSpan(nulltext || "null", style);
        }
        if (bindVal == 0 && !durationAttr) {
            return NodeUtils.renderTextSpan(nulltext || "null", style);
        }
        if (typeof(bindVal) != "number" || isNaN(bindVal)) {
            return NodeUtils.renderTextSpan("invalid", style);
        }
        let text = null;
        try {
            let val = bindVal;
            let formatAttr = ctx.resolveAttr("format");
            if (modeAttr == "s") {
                val = val * 1000;
            }
            else if (modeAttr == "ms") {
                val = val;
            }
            else if (modeAttr == "us") {
                val = val / 1000;
            }
            else if (modeAttr == "ns") {
                val = val / 1000000;
            }
            if (durationAttr) {
                let dur = dayjs.duration(val);
                if (formatAttr == null || formatAttr == "humanize") {
                    text = dur.humanize();
                }
                else {
                    text = dayjs.utc(dur.as("milliseconds")).format(formatAttr);
                }
            }
            else if (relativeAttr) {
                text = dayjs(val).fromNow();
            }
            else {
                text = dayjs(val).format(formatAttr);
            }
            
        } catch (e) {
            text = "ERR[" + e + "]";
        }
        return NodeUtils.renderTextSpan(text, style);
    }
}

@mobxReact.observer
class NopNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    render() {
        return null;
    }
}

class RunHandlerNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    componentDidMount() {
        let ctx = new DBCtx(this);
        ctx.handleOnX("onrunhandler");
    }
    
    render() {
        return null;
    }
}

@mobxReact.observer
class WithContextNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    render() {
        let ctx = new DBCtx(this);
        let contextattr = ctx.resolveAttr("context");
        if (contextattr == null) {
            return <ErrorMsg message="<d-withcontext> no context attribute"/>;
        }
        try {
            let ctxDataenv = DataCtx.ParseAndCreateContextThrow(contextattr, ctx.childDataenv, "<d-withcontext>");
            return ctxRenderHtmlChildren(ctx, ctxDataenv);
        }
        catch (e) {
            return <ErrorMsg message={"<d-withcontext> Error parsing/executing context block: " + e}/>;
        }
    }
}

@mobxReact.observer
class ChildrenNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    render() {
        let ctx = new DBCtx(this);
        let dataLV = ctx.resolveData("data", false);
        let children = dataLV.get();
        if (children == null) {
            if (ctx.node.list == null) {
                return null;
            }
            let rtnElems = ctxRenderHtmlChildren(ctx);
            if (rtnElems == null) {
                return null;
            }
            return <React.Fragment>{rtnElems}</React.Fragment>;
        }
        for (let i=0; i<children.length; i++) {
            let c = children[i];
            if (c == null || c.tag == null) {
                return <ErrorMsg message={sprintf("<d-children> bad child node @ index:%d", i)}/>;
            }
        }
        let rtnElems = renderHtmlChildren({list: children}, ctx.childDataenv);
        if (rtnElems == null) {
            return null;
        }
        return <React.Fragment>{rtnElems}</React.Fragment>;
    }
}

@mobxReact.observer
class DynNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    curHtml : string = null;
    curHtmlObj : HibikiNode = null;

    render() {
        let ctx = new DBCtx(this);
        let dataLV = ctx.resolveData("data", false);
        let bindVal = DataCtx.demobx(dataLV.get());
        if (bindVal == null) {
            return null;
        }
        if (bindVal != this.curHtml) {
            this.curHtml = bindVal;
            this.curHtmlObj = null;
            try {
                this.curHtmlObj = parseHtml(bindVal);
            }
            catch (e) {
                ctx.dataenv.dbstate.reportErrorObj({message: "Error parsing HTML in d-dyn node: " + e.toString(), err: e});
            }
        }
        if (this.curHtmlObj == null) {
            return null;
        }
        return (
            <React.Fragment>
                <NodeList list={this.curHtmlObj.list} ctx={ctx}/>
            </React.Fragment>
        );
    }
}

class SimpleQueryNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    refreshCount : mobx.IObservableValue<number>;
    callNum : number = 0;
    autorunDisposer : () => void = null;
    nameComputed : mobx.IComputedValue<string>;

    constructor(props : any) {
        super(props);
        let self = this;
        this.refreshCount = mobx.observable.box(0, {name: "refreshCount"});
        this.nameComputed = mobx.computed(() => {
            let ctx = new DBCtx(self);
            let name = ctx.resolveAttr("name");
            if (name != null) {
                return name;
            }
            try {
                let ctx = new DBCtx(self);
                let queryStr = ctx.resolveAttr("query");
                let callStmt = DataCtx.ParseStaticCallStatement(queryStr);
                let handler = DataCtx.evalExprAst(callStmt.handler, ctx.dataenv);
                return handler || "invalid-query";
            }
            catch (e) {
                return "invalid-query";
            }
        }, {name: "nameComputed"});
    }

    executeQuery(ctx : DBCtx, curCallNum : number) {
        let dbstate = ctx.dataenv.dbstate;
        let rtctx = new RtContext();
        let name = ctx.resolveAttr("name");
        rtctx.pushContext(sprintf("Evaluating <d-data name=\"%s\"> (in %s)", name, ctx.dataenv.getHtmlContext()));
        try {
            let queryStr = ctx.resolveAttr("query");
            if (queryStr == null) {
                return;
            }
            rtctx.pushContext("Parsing 'query' attribute (must be a data handler expression)");
            let callStmt = DataCtx.ParseStaticCallStatement(queryStr);
            let handler = DataCtx.evalExprAst(callStmt.handler, ctx.dataenv);
            rtctx.popContext();
            rtctx.pushContext("Evaluating 'query' parameters");
            let handlerData = null;
            if (callStmt.data != null) {
                handlerData = DataCtx.evalExprAst(callStmt.data, ctx.dataenv);
            }
            rtctx.popContext();
            rtctx.pushContext(sprintf("Calling data handler '%s'", handler));
            let qrtn = dbstate.callHandlerInternalAsync(handler, handlerData, true, {rtContext: rtctx, dataenv: ctx.dataenv});
            qrtn.then((queryRtn) => {
                if (curCallNum != this.callNum) {
                    console.log("<d-data> not setting stale data return");
                    return;
                }
                let outputLV = ctx.resolveData("output", true);
                outputLV.set(queryRtn);
            }).catch((e) => {
                dbstate.reportErrorObj({message: e.toString(), err: e, rtctx: rtctx});
            });
        }
        catch (e) {
            dbstate.reportErrorObj({message: e.toString(), err: e, rtctx: rtctx});
        }
    }

    @boundMethod
    doGetData() {
        let ctx = new DBCtx(this);
        let dbstate = ctx.dataenv.dbstate;
        let version = dbstate.RenderVersion.get();
        let refreshCount = this.refreshCount.get();
        this.callNum++;
        let curCallNum = this.callNum;
        let name = this.nameComputed.get();
        dbstate.registerDataNodeState(ctx.uuid, name, this);
        setTimeout(() => this.executeQuery(ctx, curCallNum), 10);
    }

    forceRefresh() {
        this.refreshCount.set(this.refreshCount.get() + 1);
    }

    componentDidMount() {
        this.autorunDisposer = mobx.autorun(this.doGetData);
    }

    componentWillUnmount() {
        if (this.autorunDisposer != null) {
            this.autorunDisposer();
        }
    }
    
    render() {
        let ctx = new DBCtx(this);
        let queryStr = ctx.resolveAttr("query");
        if (queryStr == null) {
            return <ErrorMsg message="<d-data> without query attribute"/>;
        }
        try {
            DataCtx.ParseStaticCallStatement(queryStr);
        }
        catch (e) {
            return <ErrorMsg message="<d-data> error parsing query attribute"/>;
        }
        return null;
    }
}

@mobxReact.observer
class InlineDataNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}> {
    constructor(props : any) {
        super(props);
    }

    componentDidMount() {
        let ctx = new DBCtx(this);
        if (ctx.isEditMode()) {
            return;
        }
        let format = ctx.resolveAttr("format");
        if (format == null) {
            format = "json";
        }
        if (format != "json" && format != "jseval") {
            console.log("<d-inlinedata> invalid 'format' attribute");
            return null;
        }
        let text = textContent(ctx.node);
        try {
            let setData = null;
            if (format == "json") {
                setData = JSON.parse(text);
            }
            else if (format == "jseval") {
                let evalVal = eval("(" + text + ")");
                if (typeof(evalVal) == "function") {
                    evalVal = evalVal();
                }
                setData = evalVal;
            }
            let outputLV = ctx.resolveData("output", true);
            outputLV.set(setData);
        } catch (e) {
            console.log("ERROR parsing <d-inlinedata> value", e);
        }
    }
    
    render() {
        return null;
    }
}

class RenderLogNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    render() {
        let ctx = new DBCtx(this);
        let dataLV = ctx.resolveData("data", false);
        console.log("Hibiki RenderLog", DataCtx.demobx(dataLV.get()));
        return null;
    }
}

@mobxReact.observer
class DataSorterNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    autorunDisposer : () => void = null;

    sortcolComputed : mobx.IComputedValue<string>;
    sortascComputed : mobx.IComputedValue<boolean>;
    dataComputed : mobx.IComputedValue<any[]>;

    constructor(props : any) {
        super(props);

        let self = this;
        this.sortcolComputed = mobx.computed(() => {
            let ctx = new DBCtx(self);
            let columnLV = ctx.resolveData("sortspec", false).subMapKey("column");
            return DataCtx.demobx(columnLV.get());
        });

        this.sortascComputed = mobx.computed(() => {
            let ctx = new DBCtx(self);
            let sortSpecLV = ctx.resolveData("sortspec", false)
            if (sortSpecLV.get() == null) {
                return true;
            }
            let ascLV = sortSpecLV.subMapKey("asc");
            return !!ascLV.get();
        });
    }
    
    @boundMethod
    doSort() {
        let ctx = new DBCtx(this);
        let sortcol = this.sortcolComputed.get();
        let sortasc = this.sortascComputed.get();

        let data = null;
        let sortInPlace = ctx.resolveAttr("inplace");
        if (sortInPlace) {
            let valueLV = ctx.resolveData("data", true);
            data = valueLV.get();
            if (data == null) {
                return;
            }
            if (!mobx.isObservableArray(data)) {
                console.log("d-datasorter value is not an array lvalue");
                return;
            }
        }
        else {
            let dataLV = ctx.resolveData("data", false);
            data = dataLV.get();
            if (data == null || !mobx.isArrayLike(data)) {
                data = [];
            }
        }
        mobx.action(() => {
            let sortedData = data;
            sortedData = data.sort((a, b) => {
                let rtn = 0;
                if (a == null && b == null) {
                    return 0;
                }
                if (a == null && b != null) {
                    return (sortasc ? -1 : 1);
                }
                if (a != null && b == null) {
                    return (sortasc ? 1 : -1);
                }
                if (sortcol != null && (typeof(a) != "object" || typeof(b) != "object")) {
                    return 0;
                }
                let aval = (sortcol == null ? a : a[sortcol]);
                let bval = (sortcol == null ? b : b[sortcol]);
                if (typeof(aval) == "string") {
                    aval = aval.toLowerCase();
                }
                if (typeof(bval) == "string") {
                    bval = bval.toLowerCase();
                }
                if (aval < bval) {
                    rtn = -1;
                }
                if (aval > bval) {
                    rtn = 1;
                }
                if (!sortasc) {
                    rtn = -rtn;
                }
                return rtn;
            });
            if (sortInPlace) {
                data.replace(sortedData);
            }
            else {
                let valueLV = ctx.resolveData("output", true);
                valueLV.set(sortedData);
            }
        })();
    }

    componentDidMount() {
        this.autorunDisposer = mobx.autorun(this.doSort);
    }

    componentWillUnmount() {
        if (this.autorunDisposer != null) {
            this.autorunDisposer();
        }
    }

    render() {
        return null;
    }
}

@mobxReact.observer
class DataPagerNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    autorunDisposer : () => void = null;
    dataComputed : mobx.IComputedValue<any[]>;
    dataIsNullComputed : mobx.IComputedValue<boolean>;
    totalsizeComputed : mobx.IComputedValue<number>;
    pagesizeComputed : mobx.IComputedValue<number>;
    curpageComputed : mobx.IComputedValue<number>;

    constructor(props : any) {
        super(props);
        let ctx = new DBCtx(this);
        let curpageLV = ctx.resolveData("pagespec", true).subMapKey("curpage");
        if (curpageLV.get() == null && ctx.hasAttr("curpage.default")) {
            let defaultCurpage = ctx.resolveAttr("curpage.default", {raw: true});
            curpageLV.set(defaultCurpage);
        }
        let self = this;

        this.dataIsNullComputed = mobx.computed(() => {
            let dataLV = ctx.resolveData("data", false);
            let data = dataLV.get();
            return (data == null);
        }, {name: "data-isnull"});
            
        this.dataComputed = mobx.computed(() => {
            let ctx = new DBCtx(self);
            let dataLV = ctx.resolveData("data", false);
            let data = dataLV.get();
            if (data == null || !mobx.isArrayLike(data)) {
                data = [];
            }
            return data;
        }, {name: "data"});
        
        this.totalsizeComputed = mobx.computed(() => {
            let data = self.dataComputed.get();
            return data.length;
        }, {name: "totalsize"});

        this.pagesizeComputed = mobx.computed(() => {
            let ctx = new DBCtx(self);
            return resolveNumber(ctx.resolveAttr("pagesize"), (val) => (val > 0), 10);
        }, {name: "pagesize"});
        
        this.curpageComputed = mobx.computed(() => {
            let ctx = new DBCtx(self);
            let curpageLV = ctx.resolveData("pagespec", true).subMapKey("curpage");
            let curpage = resolveNumber(DataCtx.demobx(curpageLV.get()), (val) => (val >= 0), 0);
            if (curpage < 0) {
                curpage = 0;
            }
            if (curpage > 0) {
                let totalsize = self.totalsizeComputed.get();
                let pagesize = self.pagesizeComputed.get();
                if (curpage * pagesize >= totalsize) {
                    curpage = Math.floor((totalsize-1) / pagesize);
                }
            }
            return curpage;
        }, {name: "curpage"});
    }

    // pagespec
    //   pagesize
    //   curpage
    //   total
    //   hasnext
    //   hasprev
    //   start
    //   num
    
    @boundMethod
    doPagination() {
        let ctx = new DBCtx(this);
        let dataIsNull = this.dataIsNullComputed.get();
        if (dataIsNull) {
            setTimeout(mobx.action(() => {
                let nodataLV = ctx.resolveData("pagespec", true).subMapKey("nodata");
                nodataLV.set(true);
            }), 0);
            return;
        }
        let pagesize = this.pagesizeComputed.get();
        let curpage = this.curpageComputed.get();
        let data = this.dataComputed.get();
        let totalsize = data.length;
        let start = curpage*pagesize;
        let num = (start + pagesize > totalsize ? totalsize - start : pagesize);
        let lastpage = Math.floor((totalsize-1) / pagesize);
        if (lastpage < 0) {
            lastpage = 0;
        }
        let pageSpec = {
            start: start,
            num: num,
            pagesize: pagesize,
            curpage: curpage,
            total: totalsize,
            hasnext: (totalsize > start+num),
            hasprev: (curpage > 0),
            lastpage: lastpage,
        };
        setTimeout(mobx.action(() => {
            let output = data.slice(curpage*pagesize, (curpage+1)*pagesize);
            let valueLV = ctx.resolveData("output", true);
            valueLV.set(output);
            let pageSpecLV = ctx.resolveData("pagespec", true);
            pageSpecLV.set(pageSpec);
        }), 0);
    }

    componentDidMount() {
        this.autorunDisposer = mobx.autorun(this.doPagination);
    }

    componentWillUnmount() {
        if (this.autorunDisposer != null) {
            this.autorunDisposer();
        }
    }

    render() {
        return null;
    }
}

class SimpleTableNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    render() {
        return (
            <table>
                <thead>
                </thead>
                <tbody>
                </tbody>
            </table>
        );
    }
}

@mobxReact.observer
class DashElemNode extends React.Component<{ctx : DBCtx, extClass? : string, extStyle? : any}, {}> {
    render() {
        let ctx = this.props.ctx;
        let cnMap = ctx.resolveCnMap("class", this.props.extClass);
        let style = ctx.resolveStyleMap("style", this.props.extStyle);
        return (
            <div className={cn(cnMap, "dashelem")} style={style}>
                {this.props.children}
            </div>
        );
    }
}

let CORE_LIBRARY : LibraryType = {
    name: "@hibiki/core",
    components: {
        "if": {componentType: "hibiki-native", impl: IfNode},
        "d-if": {componentType: "hibiki-native", impl: IfNode},
        "if-break": {componentType: "hibiki-native", impl: IfNode},
        "foreach": {componentType: "hibiki-native", impl: ForEachNode},
        "d-foreach": {componentType: "hibiki-native", impl: ForEachNode},
        "d-text": {componentType: "hibiki-native", impl: TextNode},
        "script": {componentType: "hibiki-native", impl: ScriptNode},
        "d-script": {componentType: "hibiki-native", impl: ScriptNode},
        "d-dateformat": {componentType: "hibiki-native", impl: DateFormatNode},
        "define-vars": {componentType: "hibiki-native", impl: NopNode},
        "define-handler": {componentType: "hibiki-native", impl: NopNode},
        "d-dyn": {componentType: "hibiki-native", impl: DynNode},
        "d-runhandler": {componentType: "hibiki-native", impl: RunHandlerNode},
        "d-withcontext": {componentType: "hibiki-native", impl: WithContextNode},
        "d-children": {componentType: "hibiki-native", impl: ChildrenNode},
        "d-data": {componentType: "hibiki-native", impl: SimpleQueryNode},
        "d-inlinedata": {componentType: "hibiki-native", impl: InlineDataNode},
        "d-renderlog": {componentType: "hibiki-native", impl: RenderLogNode},
        "d-datasorter": {componentType: "hibiki-native", impl: DataSorterNode},
        "d-datapager": {componentType: "hibiki-native", impl: DataPagerNode},
        "d-table": {componentType: "hibiki-native", impl: SimpleTableNode},
    },
};

export {HibikiRootNode, CORE_LIBRARY};
