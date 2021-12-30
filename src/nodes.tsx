// Copyright 2021 Dashborg Inc

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import * as cn from "classnames/dedupe";
import {sprintf} from "sprintf-js";
import {boundMethod} from 'autobind-decorator'
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import {v4 as uuidv4} from 'uuid';
import dayjs from "dayjs";
import dayjsDuration from "dayjs/plugin/duration";
import dayjsRelativeTime from "dayjs/plugin/relativeTime";
import dayjsUtc from "dayjs/plugin/utc";
import dayjsRelative from "dayjs/plugin/relativeTime";

import type {HibikiNode, ComponentType, LibraryType, HibikiExtState, LibComponentType} from "./types";
import {DBCtx} from "./dbctx";
import * as DataCtx from "./datactx";
import {HibikiState, DataEnvironment, getAttributes, getAttribute, getStyleMap} from "./state";
import {valToString, valToInt, valToFloat, resolveNumber, isObject, textContent, SYM_PROXY, SYM_FLATTEN, jseval, nodeStr, getHibiki, addToArrayDupCheck, removeFromArray, valInArray} from "./utils";
import {parseHtml} from "./html-parser";
import * as NodeUtils from "./nodeutils";
import {RtContext, HibikiError} from "./error";
import type {HAction} from "./datactx";

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
class HibikiRootNode extends React.Component<{hibikiState : HibikiExtState}, {}> {
    renderingDBState : HibikiState;
    loadUuid : string;

    constructor(props : any) {
        super(props);
    }

    getHibikiState() : HibikiState {
        return (this.props.hibikiState as any).state;
    }

    getDataenv() : DataEnvironment {
        return this.getHibikiState().pageDataenv();
    }
    
    componentDidMount() {
        let dbstate = this.getHibikiState();
        let flowerEmoji = String.fromCodePoint(0x1F338);
        if (dbstate.allowUsageImg() && !usageFired) {
            usageFired = true;
            let usageImg = new Image();
            usageImg.src = "https://static.dashborg.net/static/hibiki-usage.gif";
            usageImg.onload = function() {};
        }
        if (dbstate.allowWelcomeMessage() && !welcomeMessage) {
            welcomeMessage = true;
            console.log(flowerEmoji + " Hibiki HTML https://github.com/dashborg/hibiki | Developed by Dashborg Inc https://dashborg.net");
        }
    }

    getHibikiNode() : HibikiNode {
        return this.getHibikiState().findCurrentPage();
    }
    
    render() {
        let dbstate = this.getHibikiState();
        let node = this.getHibikiNode();
        let dataenv = this.getDataenv();
        let ctx = new DBCtx(null, node, dataenv);
        let rootClasses = "";
        if (ctx.dataenv.dbstate.Ui == "dashborg") {
            rootClasses += "rootdiv dashelem col";
        }
        let cnMap = ctx.resolveCnMap("class", rootClasses);
        let style = ctx.resolveStyleMap("style");
        this.renderingDBState = ctx.dataenv.dbstate;
        return (
            <div style={style} className={cn(cnMap)}>
                <NodeList list={ctx.node.list} ctx={ctx} isRoot={true}/>
            </div>
        );
    }
}

function evalOptionChildren(node : HibikiNode, dataenv : DataEnvironment) : string {
    if (node.list == null) {
        return null;
    }
    let textRtn = null;
    for (let i=0; i<node.list.length; i++) {
        let text = staticEvalTextNode(node.list[i], dataenv);
        if (text != null) {
            textRtn = (textRtn ?? "") + text;
        }
    }
    return textRtn;
}

function ctxRenderHtmlChildren(ctx : DBCtx, dataenv? : DataEnvironment) : (Element | string)[] {
    if (dataenv == null) {
        dataenv = ctx.dataenv;
    }
    if (ctx.node.tag == "option") {
        return [evalOptionChildren(ctx.node, dataenv)];
    }
    let rtn = baseRenderHtmlChildren(ctx.node.list, dataenv, false);
    return rtn;
}

function baseRenderHtmlChildren(list : HibikiNode[], dataenv : DataEnvironment, isRoot : boolean) : Element[] {
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
            rtn.push(<AnyNode node={child} dataenv={dataenv}/>);
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
                let ctxDataenv = DataCtx.ParseAndCreateContextThrow(contextAttr, "context", dataenv, "<define-vars>");
                dataenv = ctxDataenv;
            }
            catch (e) {
                rtn.push(<ErrorMsg message={"<define-vars> Error parsing/executing context block: " + e}/>);
            }
            continue;
        }
        else if (child.tag == "define-handler") {
            let attrs = child.attrs || {};
            if (!isRoot) {
                rtn.push(<ErrorMsg message={"<define-handler> is only allowed at root of <hibiki>, <page>, or <define-component> nodes"}/>);
                continue;
            }
            if (attrs["if"] != null || attrs["foreach"] != null) {
                rtn.push(<ErrorMsg message={"<define-handler> does not support 'if' or 'foreach' attributes"}/>);
                continue;
            }
            if (attrs.name == null || attrs.name == "") {
                rtn.push(<ErrorMsg message={"<define-handler> requires 'name' attribute"}/>);
                continue;
            }
            continue;
        }
        else {
            rtn.push(<AnyNode node={child} dataenv={dataenv}/>);
        }
    }
    return rtn;
}

@mobxReact.observer
class NodeList extends React.Component<{list : HibikiNode[], ctx : DBCtx, isRoot? : boolean}> {
    render() {
        let {list, ctx} = this.props;
        let rtn = baseRenderHtmlChildren(list, ctx.dataenv, this.props.isRoot);
        if (rtn == null) {
            return null;
        }
        return <React.Fragment>{rtn}</React.Fragment>;
    }
}

function staticEvalTextNode(node : HibikiNode, dataenv : DataEnvironment) : string {
    let ctx = new DBCtx(null, node, dataenv);
    let tagName = ctx.node.tag;
    if (tagName == "#text") {
        return node.text;
    }
    if (tagName != "h-text") {
        return nodeStr(node);
    }
    if (!ctx.isEditMode() && ctx.hasAttr("if")) {
        let ifText = ctx.resolveAttr("if");
        let ifExpr = ctx.evalExpr(ifText);
        if (!ifExpr) {
            return null;
        }
    }
    // TODO foreach
    let rtn = NodeUtils.renderTextData(node, dataenv, true);
    return rtn;
}

@mobxReact.observer
class AnyNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    nodeType : string = "unknown";

    renderForeach(ctx : DBCtx) : any {
        let node = ctx.node;
        let foreachText = ctx.resolveAttr("foreach");
        let iteratorExpr = DataCtx.ParseIteratorExpr(foreachText);
        if (iteratorExpr == null) {
            return <ErrorMsg message={sprintf("%s invalid foreach attribute", nodeStr(ctx.node))}/>;
        }
        let iterator = DataCtx.makeIteratorFromExpr(iteratorExpr, ctx.dataenv);
        let rtnContent = [];
        let index = 0;
        for (let ctxVars of iterator) {
            let htmlContext = sprintf("%s:%d", nodeStr(ctx.node), index);
            let childEnv = ctx.dataenv.makeChildEnv(ctxVars, {htmlContext: htmlContext});
            let childCtx = new DBCtx(null, node, childEnv);
            let content = this.renderInner(childCtx, true);
            if (content != null) {
                rtnContent.push(content);
            }
            index++;
        }
        return rtnContent
    }
    
    renderInner(ctx : DBCtx, iterating : boolean) : any {
        let node = ctx.node;
        let tagName = ctx.node.tag;
        if (tagName.startsWith("hibiki-")) {
            return null;
        }
        if (!iterating && !ctx.isEditMode() && ctx.hasAttr("foreach")) {
            return this.renderForeach(ctx);
        }
        if (!ctx.isEditMode() && ctx.hasAttr("if")) {
            let ifText = ctx.resolveAttr("if");
            let ifExpr = ctx.evalExpr(ifText);
            if (!ifExpr) {
                return null;
            }
        }
        let dataenv = ctx.dataenv;
        let dbstate = dataenv.dbstate;
        let compName = ctx.resolveAttr("component") ?? tagName;
        let component = dbstate.ComponentLibrary.findComponent(compName, dataenv.getLibContext());
        if (component != null) {
            if (component.componentType == "react-custom") {
                this.nodeType = "react-component";
                return <CustomReactNode component={component} node={node} dataenv={dataenv}/>;
            }
            else if (component.componentType == "hibiki-native") {
                this.nodeType = "component";
                let ImplNode = component.impl.get();
                if (ImplNode == null && component.libName == "@main") {
                    ImplNode = getHibiki().LocalNativeComponents.get(component.name);
                }
                if (ImplNode == null) {
                    return null;
                }
                return <ImplNode node={node} dataenv={dataenv}/>;
            }
            else if (component.componentType == "hibiki-html") {
                this.nodeType = "hibiki-html-component";
                return <CustomNode component={component} node={node} dataenv={dataenv}/>;
            }
            else {
                this.nodeType = "unknown";
                return <div>&lt;{compName}&gt;</div>;
            }
        }
        if (compName.startsWith("html-") || compName.indexOf("-") == -1) {
            this.nodeType = "rawhtml";
            return <RawHtmlNode node={node} dataenv={dataenv}/>
        }
        this.nodeType = "unknown";
        return <div>&lt;{compName}&gt;</div>;
    }

    render() {
        let ctx = new DBCtx(this);
        let content = this.renderInner(ctx, false)
        return content;
    }
}

@mobxReact.observer
class CustomReactNode extends React.Component<{node : HibikiNode, component : ComponentType, dataenv : DataEnvironment}, {}> {
    componentDidMount() {
        let ctx = new DBCtx(this);
        if (ctx.isEditMode()) {
            return;
        }
        ctx.handleEvent("mount");
    }
    
    render() {
        let ctx = new DBCtx(this);
        let dataenv = ctx.dataenv;
        let component = this.props.component;
        let implBox = component.reactimpl;
        let reactImpl = implBox.get();
        if (reactImpl == null && component.libName == "@main") {
            reactImpl = getHibiki().LocalReactComponents.get(component.name);
        }
        if (reactImpl == null) {
            return null;
        }
        let attrs = ctx.resolveAttrs({raw: true});
        let nodeVar = NodeUtils.makeNodeVar(ctx);
        let htmlContext = sprintf("react:%s", nodeStr(ctx.node));
        let childEnv = ctx.dataenv.makeChildEnv({node: nodeVar}, {htmlContext: htmlContext, libContext: component.libName});
        let rtnElems = baseRenderHtmlChildren(ctx.node.list, childEnv, false)
        let reactElem = React.createElement(reactImpl, attrs, rtnElems);
        return reactElem;
    }
}

async function convertBlobArray(blobArr : Blob[]) : Promise<DataCtx.HibikiBlob[]> {
    let rtn : DataCtx.HibikiBlob[] = [];
    for (let i=0; i<blobArr.length; i++) {
        rtn[i] = await DataCtx.BlobFromBlob(blobArr[i]);
    }
    return rtn;
}

@mobxReact.observer
class RawHtmlNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    constructor(props : any) {
        super(props);
        let ctx = new DBCtx(this);
    }

    componentDidMount() {
        let ctx = new DBCtx(this);
        if (ctx.isEditMode()) {
            return;
        }
        if (ctx.hasAttr("mount.handler")) {
            ctx.handleEvent("mount");
        }
    }

    @boundMethod handleFileOnChange(e) {
        let ctx = new DBCtx(this);
        let isMultiple = !!ctx.resolveAttr("multiple");
        let hasBindPath = ctx.hasAttr("value.bindpath");
        let p = convertBlobArray(e.target.files);
        p.then((hblobArr) => {
            if (isMultiple) {
                if (hblobArr.length == 0) {
                    hblobArr = null;
                }
                ctx.handleOnChange(hblobArr);
                if (hasBindPath) {
                    let valueLV = ctx.resolveData("value", true);
                    valueLV.set(hblobArr);
                }
            }
            else {
                let blob : DataCtx.HibikiBlob = null;
                if (hblobArr.length > 0) {
                    blob = hblobArr[0];
                }
                ctx.handleOnChange(blob);
                if (hasBindPath) {
                    let valueLV = ctx.resolveData("value", true);
                    valueLV.set(blob);
                }
            }
        });
    }

    @boundMethod handleValueOnChange(e) {
        let ctx = new DBCtx(this);
        let hasBindPath = ctx.hasAttr("value.bindpath");
        let newValue = e.target.value;
        NodeUtils.handleConvertType(ctx, newValue);
        ctx.handleOnChange(newValue);
        if (hasBindPath) {
            let valueLV = ctx.resolveData("value", true);
            valueLV.set(newValue);
        }
    }

    @boundMethod handleRadioOnChange(e) {
        let ctx = new DBCtx(this);
        let hasBindPath = ctx.hasAttr("formvalue.bindpath");
        let newValue = e.target.checked;
        ctx.handleOnChange(newValue);
        if (hasBindPath) {
            let formValueLV = ctx.resolveData("formvalue", true);
            let radioValue = ctx.resolveAttr("value") ?? "on";
            formValueLV.set(radioValue);
        }
    }

    @boundMethod handleCheckboxOnChange(e) {
        let ctx = new DBCtx(this);
        let hasCheckedBindPath = ctx.hasAttr("checked.bindpath");
        let hasFormValueBindPath = ctx.hasAttr("formvalue.bindpath");
        let newValue = e.target.checked;
        ctx.handleOnChange(newValue);
        if (hasCheckedBindPath) {
            let checkedLV = ctx.resolveData("checked", true);
            checkedLV.set(newValue);
        }
        else if (hasFormValueBindPath) {
            let formValueLV = ctx.resolveData("formvalue", true);
            let checkboxValue = ctx.resolveAttr("value") ?? "on";
            if (newValue) {
                let newFormValue = addToArrayDupCheck(formValueLV.get(), checkboxValue);
                formValueLV.set(newFormValue);
            }
            else {
                let newFormValue = removeFromArray(formValueLV.get(), checkboxValue);
                formValueLV.set(newFormValue);
            }
            
        }
    }

    setupManagedValue(ctx : DBCtx, elemProps : Record<string, any>) {
        let isBound = !!ctx.resolveAttr("bound");
        let hasBindPath = ctx.hasAttr("value.bindpath");
        if (hasBindPath) {
            // 2-way data-binding
            let valueLV = ctx.resolveData("value", true);
            elemProps["onChange"] = this.handleValueOnChange;
            elemProps["value"] = valueLV.get() ?? "";
        }
        else if (isBound) {
            // 1-way data-binding
            let value = ctx.resolveAttr("value");
            elemProps["onChange"] = this.handleValueOnChange;
            elemProps["value"] = value ?? "";
        }
        else {
            // not managed
            let value = ctx.resolveAttr("value");
            if (value != null) {
                elemProps["defaultValue"] = value;
            }
        }
    }

    setupManagedFile(ctx : DBCtx, elemProps : Record<string, any>) {
        elemProps["onChange"] = this.handleFileOnChange;
    }

    setupManagedRadio(ctx : DBCtx, elemProps : Record<string, any>) {
        let isBound = !!ctx.resolveAttr("bound");
        let hasBindPath = ctx.hasAttr("formvalue.bindpath");
        if (hasBindPath) {
            // 2-way data-binding
            let formValueLV = ctx.resolveData("formvalue", true);
            let radioValue = ctx.resolveAttr("value") ?? "on";
            let checked = (formValueLV.get() == radioValue);
            elemProps["checked"] = checked;
            elemProps["onChange"] = this.handleRadioOnChange;
        }
        else if (isBound) {
            // 1-way data-binding
            let checked = ctx.resolveAttr("checked");
            elemProps["checked"] = !!checked;
            elemProps["onChange"] = this.handleRadioOnChange;
        }
        else {
            // not managed
            let checked = ctx.resolveAttr("checked");
            if (checked) {
                elemProps["defaultChecked"] = true;
            }
        }
    }

    setupManagedCheckbox(ctx : DBCtx, elemProps : Record<string, any>) {
        let isBound = !!ctx.resolveAttr("bound");
        let hasCheckedBindPath = ctx.hasAttr("checked.bindpath");
        let hasFormValueBindPath = ctx.hasAttr("formvalue.bindpath");
        if (hasCheckedBindPath) {
            // 2-way simple data-binding
            let checkedLV = ctx.resolveData("checked", true);
            elemProps["checked"] = !!checkedLV.get();
            elemProps["onChange"] = this.handleCheckboxOnChange;
        }
        else if (hasFormValueBindPath) {
            // 2-way group data-binding
            let formValueLV = ctx.resolveData("formvalue", true);
            let checkboxValue = ctx.resolveAttr("value") ?? "on";
            let checked = valInArray(formValueLV.get(), checkboxValue);
            elemProps["checked"] = checked;
            elemProps["onChange"] = this.handleCheckboxOnChange;
        }
        else if (isBound) {
            // 1-way data-binding
            let checked = ctx.resolveAttr("checked");
            elemProps["checked"] = !!checked;
            elemProps["onChange"] = this.handleCheckboxOnChange;
        }
        else {
            // not managed
            let checked = ctx.resolveAttr("checked");
            if (checked) {
                elemProps["defaultChecked"] = true;
            }
        }
    }
    
    render() {
        let ctx = new DBCtx(this);
        let tagName = ctx.getHtmlTagName();
        let elemProps : Record<string, any> = {};
        let attrs = ctx.resolveAttrs();
        let typeAttr = attrs["type"];
        let managedType = NodeUtils.getManagedType(tagName, typeAttr);
        let managedAttrs = NodeUtils.MANAGED_ATTRS[managedType] ?? {};
        for (let [k,v] of Object.entries(attrs)) {
            k = k.toLowerCase();
            if (NodeUtils.SPECIAL_ATTRS[k] || managedAttrs[k]) {
                continue;
            }
            if (k.startsWith("on")) {
                continue;
            }
            if (k.endsWith(".bindpath") || k.endsWith(".handler") || k.endsWith(".default")) {
                continue;
            }
            if (k == "download" && v == "1") {
                elemProps["download"] = "";
                continue;
            }
            elemProps[k] = v;
        }
        if (managedType == "radio") {
            console.log("radio", ctx.node, elemProps);
        }
        if (!ctx.isEditMode()) {
            if (attrs["blobsrc"] != null) {
                let blob = attrs["blobsrc"];
                if (!(blob instanceof DataCtx.HibikiBlob)) {
                    console.log("Invalid blobsrc attribute, not a Blob object");
                }
                else {
                    if (tagName == "link") {
                        elemProps.href = blob.makeDataUrl();
                    }
                    else {
                        elemProps.src = blob.makeDataUrl();
                    }
                }
            }

            // forms are managed if submit.handler
            if (tagName == "form" && ctx.hasAttr("submit.handler")) {
                elemProps.onSubmit = ctx.handleOnSubmit;
            }

            if (ctx.hasAttr("click.handler")) {
                elemProps.onClick = ctx.handleOnClick;
                // anchors with click.handler work like links (not locations)
                if (tagName == "a" && elemProps["href"] == null) {
                    elemProps["href"] = "#";
                }
            }
            
            if (managedType != null) {
                if (managedType == "value") {
                    this.setupManagedValue(ctx, elemProps);
                }
                else if (managedType == "radio") {
                    this.setupManagedRadio(ctx, elemProps);
                }
                else if (managedType == "checkbox") {
                    this.setupManagedCheckbox(ctx, elemProps);
                }
                else if (managedType == "file") {
                    this.setupManagedFile(ctx, elemProps);
                }
                else {
                    console.log("Invalid managedType", managedType);
                }
            }
        }
        // automerge
        this.doAutomerge(ctx, attrs, elemProps);
        let elemChildren = ctxRenderHtmlChildren(ctx);
        return React.createElement(tagName, elemProps, elemChildren);
    }

    doAutomerge(ctx : DBCtx, attrs : Record<string, any>, elemProps : Record<string, any>) {
        let style = ctx.resolveStyleMap("style");
        let cnMap = ctx.resolveCnMap("class");
        let automergeAttrs = {
            style: style,
            cnMap: cnMap,
            disabled: null,
        };
        if (attrs.automerge != null) {
            let automergeArr = NodeUtils.parseAutomerge(attrs.automerge);
            for (let i=0; i<automergeArr.length; i++) {
                let amParams = automergeArr[i];
                NodeUtils.automerge(ctx, automergeAttrs, amParams.name, amParams.opts);
            }
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
    }
}

@mobxReact.observer
class CustomNode extends React.Component<{node : HibikiNode, component : ComponentType, dataenv : DataEnvironment}, {}> {
    constructor(props : any) {
        super(props);
        this.makeCustomChildEnv(true);
    }
    
    makeCustomChildEnv(initialize : boolean) : DataEnvironment {
        let ctx = new DBCtx(this);
        let component = this.props.component;
        let implNode = component.node;
        let rawImplAttrs = implNode.attrs || {};
        let nodeVar = NodeUtils.makeNodeVar(ctx);
        let childrenVar = NodeUtils.makeChildrenVar(ctx.dataenv, ctx.node);
        let argDecls = NodeUtils.parseArgsDecl(rawImplAttrs.args);
        let componentName = rawImplAttrs.name;
        let nodeDataBox = ctx.dataenv.dbstate.NodeDataMap.get(ctx.uuid);
        if (nodeDataBox == null) {
            let uuidName = "id_" + ctx.uuid.replace(/-/g, "_");
            nodeDataBox = mobx.observable.box({_hibiki: {"customtag": componentName, uuid: ctx.uuid}}, {name: uuidName});
            ctx.dataenv.dbstate.NodeDataMap.set(ctx.uuid, nodeDataBox);
        }
        let ctxHandlers = NodeUtils.makeHandlers(ctx.node);
        let eventCtx = sprintf("%s", nodeStr(ctx.node));
        let eventDE = ctx.dataenv.makeChildEnv(null, {eventBoundary: "hard", handlers: ctxHandlers, htmlContext: eventCtx});
        let nodeDataLV = new DataCtx.ObjectLValue(null, nodeDataBox);
        let specials : Record<string, any> = {};
        specials.children = childrenVar;
        specials.node = nodeVar;
        let resolvedAttrs = {};
        let handlers = NodeUtils.makeHandlers(implNode, ["event"]);
        let crootProxy = componentRootProxy(nodeDataLV, resolvedAttrs);
        let envOpts = {
            componentRoot: crootProxy,
            handlers: handlers,
            htmlContext: sprintf("<define-component %s>", componentName),
            libContext: component.libName,
            eventBoundary: "soft",
        };
        let childEnv = eventDE.makeChildEnv(specials, envOpts);
        if (initialize && rawImplAttrs.defaults != null) {
            try {
                DataCtx.ParseAndCreateContextThrow(rawImplAttrs.defaults, "c", childEnv, sprintf("<define-component %s>:defaults", componentName));
            }
            catch (e) {
                console.log(sprintf("ERROR parsing/executing 'defaults' in <define-component %s>", componentName), e);
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
        if (ctx.isEditMode()) {
            return;
        }
        ctx.handleEvent("mount");
    }

    componentWillUnmount() {
        let ctx = new DBCtx(this);
        ctx.unregisterUuid();
    }

    render() {
        let ctx = new DBCtx(this);
        ctx.registerUuid();
        let component = this.props.component;
        let implNode = component.node;
        let childEnv = this.makeCustomChildEnv(false);
        let rtnElems = baseRenderHtmlChildren(implNode.list, childEnv, true)
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
class FragmentNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    render() {
        let ctx = new DBCtx(this);
        return <NodeList list={ctx.node.list} ctx={ctx}/>;
    }
}

@mobxReact.observer
class ForEachNode extends React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}> {
    render() {
        let ctx = new DBCtx(this);
        let foreachText = ctx.resolveAttr("expr");
        let iteratorExpr = DataCtx.ParseIteratorExpr(foreachText);
        if (iteratorExpr == null) {
            return <ErrorMsg message={sprintf("Invalid <h-foreach> expr attribute")}/>;
        }
        let iterator = DataCtx.makeIteratorFromExpr(iteratorExpr, ctx.dataenv);
        let rtnElems = [];
        let index = 0;
        for (let ctxVars of iterator) {
            let htmlContext = sprintf("<h-foreach>:%d", index);
            let childEnv = ctx.dataenv.makeChildEnv(ctxVars, {htmlContext: htmlContext});
            let childElements = baseRenderHtmlChildren(ctx.node.list, childEnv, false);
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
        ctx.handleEvent("run");
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
            return <ErrorMsg message={sprintf("%s no context attribute", nodeStr(ctx.node))}/>;
        }
        try {
            let ctxDataenv = DataCtx.ParseAndCreateContextThrow(contextattr, "context", ctx.dataenv, nodeStr(ctx.node));
            return ctxRenderHtmlChildren(ctx, ctxDataenv);
        }
        catch (e) {
            return <ErrorMsg message={nodeStr(ctx.node) + " Error parsing/executing context block: " + e}/>;
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
                return <ErrorMsg message={sprintf("%s bad child node @ index:%d", nodeStr(ctx.node), i)}/>;
            }
        }
        let rtnElems = baseRenderHtmlChildren(children, ctx.dataenv, false);
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
                let errObj = new HibikiError(sprintf("Error parsing HTML in %s node: %s", nodeStr(ctx.node), e.toString()), e);
                ctx.dataenv.dbstate.reportErrorObj(errObj);
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
                let callAction = DataCtx.ParseStaticCallStatement(queryStr);
                let handler = DataCtx.evalExprAst(callAction.callpath, ctx.dataenv);
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
        // TODO register handlerName/handlerEnv for error bubbling
        rtctx.pushContext(sprintf("Evaluating %s (in %s)", nodeStr(ctx.node), ctx.dataenv.getFullHtmlContext()), null);
        try {
            let queryStr = ctx.resolveAttr("query");
            if (queryStr == null) {
                return;
            }
            rtctx.pushContext("Parsing 'query' attribute (must be a data handler expression)", null);
            let callAction = DataCtx.ParseStaticCallStatement(queryStr);
            rtctx.popContext();
            let qrtn = DataCtx.ExecuteHAction(callAction, true, ctx.dataenv, rtctx);
            qrtn.then((queryRtn) => {
                if (curCallNum != this.callNum) {
                    console.log(sprintf("%s not setting stale data return", nodeStr(ctx.node)));
                    return;
                }
                let outputLV = ctx.resolveData("output", true);
                outputLV.set(queryRtn);
                setTimeout(() => ctx.handleEvent("load", {value: queryRtn}), 10);
            }).catch((e) => {
                let errObj = new HibikiError(e.toString(), e, rtctx);
                dbstate.reportErrorObj(errObj);
            });
        }
        catch (e) {
            let errObj = new HibikiError(e.toString(), e, rtctx);
            dbstate.reportErrorObj(errObj);
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
            return <ErrorMsg message={sprintf("%s without query attribute", nodeStr(ctx.node))}/>;
        }
        try {
            DataCtx.ParseStaticCallStatement(queryStr);
        }
        catch (e) {
            return <ErrorMsg message={sprintf("%s error parsing query attribute", nodeStr(ctx.node))}/>;
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
            console.log(sprintf("%s invalid format attribute: '%s'", nodeStr(ctx.node), format));
            return null;
        }
        let text = textContent(ctx.node);
        try {
            let setData = null;
            if (format == "json") {
                setData = JSON.parse(text);
            }
            else if (format == "jseval") {
                let evalVal = jseval(text);
                setData = evalVal;
            }
            let outputLV = ctx.resolveData("output", true);
            outputLV.set(setData);
        } catch (e) {
            console.log(sprintf("ERROR parsing %s value", nodeStr(ctx.node)), e);
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
                console.log(sprintf("%s value is not an array lvalue", nodeStr(ctx.node)));
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

function addCoreComponent(name : string, impl : any) {
    let comp : LibComponentType = {componentType: "hibiki-native"};
    comp.impl = mobx.observable.box(impl, {name: "@hibiki/core/" + name});
    CORE_LIBRARY.libComponents[name] = comp;
}

let CORE_LIBRARY : LibraryType = {
    name: "@hibiki/core",
    libComponents: {},
    importedComponents: {},
    localHandlers: {},
    modules: {},
    handlers: {},
};

addCoreComponent("if", IfNode);
addCoreComponent("if-break", IfNode);
addCoreComponent("foreach", ForEachNode);
addCoreComponent("script", ScriptNode);

addCoreComponent("define-vars", NopNode);
addCoreComponent("define-handler", NopNode);
addCoreComponent("define-component", NopNode);
addCoreComponent("import-library", NopNode);

addCoreComponent("h-if", IfNode);
addCoreComponent("h-if-break", IfNode);
addCoreComponent("h-foreach", ForEachNode);
addCoreComponent("h-text", TextNode);
addCoreComponent("h-script", ScriptNode);
addCoreComponent("h-dateformat", DateFormatNode);
addCoreComponent("h-dyn", DynNode);
addCoreComponent("h-runhandler", RunHandlerNode);
addCoreComponent("h-withcontext", WithContextNode);
addCoreComponent("h-children", ChildrenNode);
addCoreComponent("h-data", SimpleQueryNode);
addCoreComponent("h-inlinedata", InlineDataNode);
addCoreComponent("h-renderlog", RenderLogNode);
addCoreComponent("h-datasorter", DataSorterNode);
addCoreComponent("h-datapager", DataPagerNode);
addCoreComponent("h-table", SimpleTableNode);
addCoreComponent("h-fragment", FragmentNode);

export {HibikiRootNode, CORE_LIBRARY};
