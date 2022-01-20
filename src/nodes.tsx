// Copyright 2021-2022 Dashborg Inc

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

import type {HibikiNode, ComponentType, LibraryType, HibikiExtState, LibComponentType, NodeAttrType, HibikiVal, HibikiReactProps} from "./types";
import {DBCtx} from "./dbctx";
import * as DataCtx from "./datactx";
import {HibikiState, DataEnvironment} from "./state";
import {resolveNumber, isObject, textContent, SYM_PROXY, SYM_FLATTEN, jseval, nodeStr, getHibiki, addToArrayDupCheck, removeFromArray, valInArray, blobPrintStr, subMapKey, unbox, bindLibContext} from "./utils";
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
            <div>{this.props.message}</div>
        );
    }
}

@mobxReact.observer
class HibikiRootNode extends React.Component<{hibikiState : HibikiExtState}, {}> {
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
            usageImg.src = "https://hibikihtml.com/hibiki-usage.gif";
            usageImg.onload = function() {};
        }
        if (dbstate.allowWelcomeMessage() && !welcomeMessage) {
            welcomeMessage = true;
            let versionStr = (getHibiki().BUILD === "devbuild" ? "devbuild" : getHibiki().VERSION + " " + getHibiki().BUILD);
            console.log(flowerEmoji + sprintf(" Hibiki HTML https://github.com/dashborg/hibiki [%s] | Developed by Dashborg Inc https://dashborg.net", versionStr));
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
        return <NodeList list={ctx.node.list} ctx={ctx} isRoot={true}/>;
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
            let [ifAttr, exists] = ifBreakCtx.resolveAttrValPair("condition");
            if (!exists) {
                rtn.push(<ErrorMsg message="<if-break> requires 'condition' attribute"/>);
                continue;
            }
            if (!ifAttr) {
                continue;
            }
            rtn.push(<AnyNode node={child} dataenv={dataenv}/>);
            break;
        }
        else if (child.tag == "define-vars") {
            let setCtx = new DBCtx(null, child, dataenv);
            let contextAttr = setCtx.resolveAttrStr("context");
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
    if (!ctx.isEditMode()) {
        let [ifAttr, exists] = ctx.resolveAttrValPair("if");
        if (exists && !ifAttr) {
            return null;
        }
    }
    // TODO foreach
    let rtn = NodeUtils.renderTextData(node, dataenv, true);
    return rtn;
}

@mobxReact.observer
class AnyNode extends React.Component<HibikiReactProps, {}> {
    nodeType : string = "unknown";

    renderForeach(ctx : DBCtx) : any {
        let node = ctx.node;
        let iterator = DataCtx.makeIteratorFromExpr(node.foreachAttr, ctx.dataenv);
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
        if (!ctx.isEditMode()) {
            if (!iterating && node.foreachAttr != null) {
                return this.renderForeach(ctx);
            }
            let ifExists = ctx.hasRawAttr("if");
            if (ifExists) {
                let ifAttrVal = ctx.resolveAttrVal("if");
                if (!ifAttrVal) {
                    return null;
                }
            }
        }
        let dataenv = ctx.dataenv;
        let dbstate = dataenv.dbstate;
        let compName = ctx.resolveAttrStr("component") ?? tagName;
        let component = dbstate.ComponentLibrary.findComponent(compName, dataenv.getLibContext());
        if (component != null) {
            if (component.componentType == "react-custom") {
                this.nodeType = "react-component";
                return <CustomReactNode component={component} node={node} dataenv={dataenv}/>;
            }
            else if (component.componentType == "hibiki-native") {
                this.nodeType = "component";
                let ImplNode = component.impl.get();
                if (ImplNode == null && component.libName == "main") {
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
class CustomReactNode extends React.Component<HibikiReactProps & {component : ComponentType}, {}> {
    componentDidMount() {
        let ctx = new DBCtx(this);
        if (ctx.isEditMode()) {
            return;
        }
        ctx.handleMountEvent();
    }
    
    render() {
        let ctx = new DBCtx(this);
        let dataenv = ctx.dataenv;
        let component = this.props.component;
        let implBox = component.reactimpl;
        let reactImpl = implBox.get();
        if (reactImpl == null && component.libName == "main") {
            reactImpl = getHibiki().LocalReactComponents.get(component.name);
        }
        if (reactImpl == null) {
            return null;
        }
        let attrs = ctx.resolveAttrVals();
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
class RawHtmlNode extends React.Component<HibikiReactProps, {}> {
    constructor(props : any) {
        super(props);
        let ctx = new DBCtx(this);
    }

    componentDidMount() {
        let ctx = new DBCtx(this);
        if (ctx.isEditMode()) {
            return;
        }
        ctx.handleMountEvent();
    }

    @boundMethod handleFileOnChange(e) {
        let ctx = new DBCtx(this);
        let isMultiple = !!ctx.resolveAttrStr("multiple");
        let valueLV = ctx.resolveLValueAttr("value");
        let p = convertBlobArray(e.target.files);
        p.then((hblobArr) => {
            if (isMultiple) {
                if (hblobArr.length == 0) {
                    hblobArr = null;
                }
                ctx.handleOnChange(hblobArr);
                if (valueLV != null) {
                    valueLV.set(hblobArr);
                }
            }
            else {
                let blob : DataCtx.HibikiBlob = null;
                if (hblobArr.length > 0) {
                    blob = hblobArr[0];
                }
                ctx.handleOnChange(blob);
                if (valueLV != null) {
                    valueLV.set(blob);
                }
            }
        });
    }

    @boundMethod handleSelectOnChange(e) {
        let ctx = new DBCtx(this);
        let valueLV = ctx.resolveLValueAttr("value");
        let isMulti = !!ctx.resolveAttrStr("multiple");
        let newValue : (string | string[]) = null;
        if (isMulti) {
            newValue = Array.from(e.target.selectedOptions, (option : HTMLOptionElement) => option.value);
        }
        else {
            newValue = e.target.value;
        }
        ctx.handleOnChange(newValue);
        if (valueLV != null) {
            valueLV.set(newValue);
        }
    }

    @boundMethod handleValueOnChange(e) {
        let ctx = new DBCtx(this);
        let valueLV = ctx.resolveLValueAttr("value");
        let newValue = e.target.value;
        NodeUtils.handleConvertType(ctx, newValue);
        ctx.handleOnChange(newValue);
        if (valueLV != null) {
            valueLV.set(newValue);
        }
        ctx.handleAfterChange(newValue);
    }

    @boundMethod handleRadioOnChange(e) {
        let ctx = new DBCtx(this);
        let formValueLV = ctx.resolveLValueAttr("formvalue");
        let newValue = e.target.checked;
        ctx.handleOnChange(newValue);
        if (formValueLV != null) {
            let radioValue = ctx.resolveAttrStr("value") ?? "on";
            formValueLV.set(radioValue);
        }
        ctx.handleAfterChange(newValue);
    }

    @boundMethod handleCheckboxOnChange(e) {
        let ctx = new DBCtx(this);
        let checkedLV = ctx.resolveLValueAttr("checked");
        let formValueLV = ctx.resolveLValueAttr("formvalue");
        let newValue = e.target.checked;
        ctx.handleOnChange(newValue);
        if (checkedLV != null) {
            checkedLV.set(newValue);
        }
        else if (formValueLV != null) {
            let checkboxValue = ctx.resolveAttrStr("value") ?? "on";
            if (newValue) {
                let newFormValue = addToArrayDupCheck(formValueLV.get(), checkboxValue);
                formValueLV.set(newFormValue);
            }
            else {
                let newFormValue = removeFromArray(formValueLV.get(), checkboxValue);
                formValueLV.set(newFormValue);
            }
        }
        ctx.handleAfterChange(newValue);
    }

    setupManagedValue(ctx : DBCtx, elemProps : Record<string, any>) {
        let isBound = !!ctx.resolveAttrStr("bound");
        let valueLV = ctx.resolveLValueAttr("value");
        if (valueLV != null) {
            // 2-way data-binding
            elemProps["onChange"] = this.handleValueOnChange;
            elemProps["value"] = valueLV.get() ?? "";
        }
        else if (isBound) {
            // 1-way data-binding
            let value = ctx.resolveAttrStr("value");
            elemProps["onChange"] = this.handleValueOnChange;
            elemProps["value"] = value ?? "";
        }
        else {
            // not managed
            let value = ctx.resolveAttrStr("value");
            if (value != null) {
                elemProps["defaultValue"] = value;
            }
            elemProps["onChange"] = this.handleValueOnChange;
        }
    }

    setupManagedFile(ctx : DBCtx, elemProps : Record<string, any>) {
        elemProps["onChange"] = this.handleFileOnChange;
    }

    setupManagedHidden(ctx : DBCtx, elemProps : Record<string, any>) {
        let formValueLV = ctx.resolveLValueAttr("formvalue");
        if (formValueLV != null) {
            let value = ctx.resolveAttrStr("value") ?? "";
            if (DataCtx.attrValToStr(formValueLV.get()) !== value) {
                setTimeout(() => formValueLV.set(value), 0);
            }
        }
    }

    setupManagedRadio(ctx : DBCtx, elemProps : Record<string, any>) {
        let isBound = !!ctx.resolveAttrStr("bound");
        let formValueLV = ctx.resolveLValueAttr("formvalue");
        if (formValueLV != null) {
            // 2-way data-binding
            let radioValue = ctx.resolveAttrStr("value") ?? "on";
            let checked = (formValueLV.get() == radioValue);
            elemProps["checked"] = checked;
            elemProps["onChange"] = this.handleRadioOnChange;
        }
        else if (isBound) {
            // 1-way data-binding
            let checked = ctx.resolveAttrStr("checked");
            elemProps["checked"] = !!checked;
            elemProps["onChange"] = this.handleRadioOnChange;
        }
        else {
            // not managed
            let checked = ctx.resolveAttrStr("checked");
            if (checked) {
                elemProps["defaultChecked"] = true;
            }
            elemProps["onChange"] = this.handleRadioOnChange;
        }
    }

    setupManagedCheckbox(ctx : DBCtx, elemProps : Record<string, any>) {
        let isBound = !!ctx.resolveAttrStr("bound");
        let checkedLV = ctx.resolveLValueAttr("checked");
        let formValueLV = ctx.resolveLValueAttr("formvalue");
        if (checkedLV != null) {
            // 2-way simple data-binding
            elemProps["checked"] = !!checkedLV.get();
            elemProps["onChange"] = this.handleCheckboxOnChange;
        }
        else if (formValueLV != null) {
            // 2-way group data-binding
            let checkboxValue = ctx.resolveAttrStr("value") ?? "on";
            let checked = valInArray(formValueLV.get(), checkboxValue);
            elemProps["checked"] = checked;
            elemProps["onChange"] = this.handleCheckboxOnChange;
        }
        else if (isBound) {
            // 1-way data-binding
            let checked = ctx.resolveAttrStr("checked");
            elemProps["checked"] = !!checked;
            elemProps["onChange"] = this.handleCheckboxOnChange;
        }
        else {
            // not managed
            let checked = ctx.resolveAttrStr("checked");
            if (checked) {
                elemProps["defaultChecked"] = true;
            }
            elemProps["onChange"] = this.handleCheckboxOnChange;
        }
    }

    setupManagedSelect(ctx : DBCtx, elemProps : Record<string, any>) {
        let isBound = !!ctx.resolveAttrStr("bound");
        let valueLV = ctx.resolveLValueAttr("value");
        let isMulti = !!ctx.resolveAttrStr("multiple");
        if (valueLV != null) {
            // 2-way data-binding
            elemProps["onChange"] = this.handleSelectOnChange;
            if (isMulti) {
                elemProps["value"] = valueLV.get() ?? [];
            }
            else {
                elemProps["value"] = valueLV.get() ?? "";
            }
        }
        else if (isBound) {
            // 1-way data-binding
            let value = ctx.resolveAttrStr("value");
            elemProps["onChange"] = this.handleSelectOnChange;
            if (isMulti) {
                elemProps["value"] = value ?? [];
            }
            else {
                elemProps["value"] = value ?? "";
            }
        }
        else {
            // not managed
            elemProps["onChange"] = this.handleSelectOnChange;
        }
    }
    
    render() {
        let ctx = new DBCtx(this);
        let tagName = ctx.getHtmlTagName();
        let elemProps : Record<string, any> = {};
        let attrVals : Record<string, HibikiVal> = ctx.resolveAttrVals();
        let typeAttr = DataCtx.attrValToStr(attrVals["type"]);
        let managedType = NodeUtils.getManagedType(tagName, typeAttr);
        let managedAttrs = NodeUtils.MANAGED_ATTRS[managedType] ?? {};
        for (let [k,v] of Object.entries(attrVals)) {
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
            if (k.startsWith("class.") || k.indexOf(":class") != -1) {
                continue;
            }
            if (v instanceof DataCtx.HibikiBlob) {
                if (NodeUtils.BLOB_ATTRS[k]) {
                    elemProps[k] = v.makeDataUrl();
                }
                else {
                    elemProps[k] = blobPrintStr(v);
                }
                continue;
            }
            let strVal = DataCtx.attrValToStr(v);
            if (k == "download" && strVal == "1") {
                elemProps["download"] = "";
                continue;
            }
            elemProps[k] = strVal;
        }
        if (!managedAttrs["value"] && elemProps["value"] == null && ctx.getRawAttr("value") == "") {
            elemProps["value"] = "";
        }
        
        if (!ctx.isEditMode()) {
            // forms are managed if submit.handler
            if (tagName == "form" && ctx.hasHandler("submit")) {
                elemProps.onSubmit = ctx.handleOnSubmit;
            }

            if (ctx.hasHandler("click")) {
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
                else if (managedType == "select") {
                    this.setupManagedSelect(ctx, elemProps);
                }
                else if (managedType == "hidden") {
                    this.setupManagedHidden(ctx, elemProps);
                }
                else {
                    console.log("Invalid managedType", managedType);
                }
            }
        }

        let style = ctx.resolveStyleMap();
        let cnArr = ctx.resolveCnArray();
        if (Object.keys(style).length > 0) {
            elemProps["style"] = style;
        }
        if (Object.keys(cnArr).length > 0) {
            elemProps["className"] = cn(cnArr);
        }
        let elemChildren = ctxRenderHtmlChildren(ctx);
        return React.createElement(tagName, elemProps, elemChildren);
    }
}

@mobxReact.observer
class CustomNode extends React.Component<HibikiReactProps & {component : ComponentType}, {}> {
    constructor(props : any) {
        super(props);
        this.makeCustomChildEnv(true);
    }
    
    makeCustomChildEnv(initialize : boolean) : DataEnvironment {
        let ctx = new DBCtx(this);
        let component = this.props.component;
        let implNode = component.node;
        let rawImplAttrs : Record<string, NodeAttrType> = implNode.attrs || {};
        let nodeVar = NodeUtils.makeNodeVar(ctx);
        let componentName = DataCtx.rawAttrStr(rawImplAttrs.name);
        let ctxHandlers = NodeUtils.makeHandlers(ctx.node, null, null);
        let eventCtx = sprintf("%s", nodeStr(ctx.node));
        let eventDE = ctx.dataenv.makeChildEnv(null, {eventBoundary: "hard", handlers: ctxHandlers, htmlContext: eventCtx});
        let nodeDataLV = ctx.getNodeDataLV(componentName);
        let specials : Record<string, any> = {};
        specials.children = new DataCtx.ChildrenVar(ctx.node.list, ctx.dataenv);
        specials.node = nodeVar;
        let argsRoot = ctx.resolveArgsRoot(implNode);
        let handlers = NodeUtils.makeHandlers(implNode, component.libName, ["event"]);
        let envOpts = {
            componentRoot: unbox(ctx.getNodeData(componentName)),
            argsRoot: argsRoot,
            handlers: handlers,
            htmlContext: sprintf("<define-component %s>", componentName),
            libContext: component.libName,
            eventBoundary: "soft",
        };
        let childEnv = eventDE.makeChildEnv(specials, envOpts);
        if (initialize && rawImplAttrs.defaults != null) {
            try {
                DataCtx.ParseAndCreateContextThrow(DataCtx.rawAttrStr(rawImplAttrs.defaults), "c", childEnv, sprintf("<define-component %s>:defaults", componentName));
            }
            catch (e) {
                console.log(sprintf("ERROR parsing/executing 'defaults' in <define-component %s>", componentName), e);
            }
        }
        return childEnv;
    }

    componentDidMount() {
        let ctx = new DBCtx(this);
        if (ctx.isEditMode()) {
            return;
        }
        ctx.handleMountEvent();
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

@mobxReact.observer
class TextNode extends React.Component<HibikiReactProps, {}> {
    render() {
        return NodeUtils.renderTextData(this.props.node, this.props.dataenv);
    }
}

@mobxReact.observer
class IfNode extends React.Component<HibikiReactProps, {}> {
    render() {
        let ctx = new DBCtx(this);
        let [condAttr, exists] = ctx.resolveAttrValPair("condition");
        if (!exists) {
            return <ErrorMsg message={sprintf("<%s> node requires 'condition' attribute", ctx.node.tag)}/>
        }
        if (!condAttr) {
            return null;
        }
        return <NodeList list={ctx.node.list} ctx={ctx}/>;
    }
}

@mobxReact.observer
class FragmentNode extends React.Component<HibikiReactProps, {}> {
    render() {
        let ctx = new DBCtx(this);
        return <NodeList list={ctx.node.list} ctx={ctx}/>;
    }
}

@mobxReact.observer
class ScriptNode extends React.Component<HibikiReactProps, {}> {
    render() {
        let ctx = new DBCtx(this);
        let srcAttr = ctx.resolveAttrVal("src");
        let isSync = !ctx.resolveAttrStr("async")
        if (srcAttr == null) {
            let scriptText = textContent(ctx.node);
            if (scriptText == null || scriptText.trim() == "") {
                return null;
            }
            ctx.dataenv.dbstate.queueScriptText(scriptText, isSync);
            return null;
        }
        if (srcAttr instanceof DataCtx.HibikiBlob) {
            ctx.dataenv.dbstate.queueScriptSrc(srcAttr.makeDataUrl(), isSync);
        }
        else {
            ctx.dataenv.dbstate.queueScriptSrc(DataCtx.attrValToStr(srcAttr), isSync);
        }
        return null;
    }
}

@mobxReact.observer
class DateFormatNode extends React.Component<HibikiReactProps, {}> {
    render() {
        let ctx = new DBCtx(this);
        let bindVal = DataCtx.demobx(ctx.resolveAttrVal("bind"));
        let modeAttr = ctx.resolveAttrStr("mode");
        let nulltext = ctx.resolveAttrStr("nulltext");
        let style = ctx.resolveStyleMap();
        let cnArr = ctx.resolveCnArray();
        if (typeof(bindVal) == "string" && modeAttr == "parse") {
            try {
                bindVal = parseFloat(dayjs(bindVal).format("x"));
            } catch (e) {
                return NodeUtils.renderTextSpan("invalid", style, cn(cnArr));
            }
        }
        let relativeAttr = !!ctx.resolveAttrStr("relative");
        let durationAttr = ctx.resolveAttrStr("duration");
        if (typeof(bindVal) == "string") {
            bindVal = parseFloat(bindVal);
        }
        if (bindVal == null) {
            return NodeUtils.renderTextSpan(nulltext ?? "null", style, cn(cnArr));
        }
        if (bindVal == 0 && !durationAttr) {
            return NodeUtils.renderTextSpan(nulltext ?? "null", style, cn(cnArr));
        }
        if (typeof(bindVal) != "number" || isNaN(bindVal)) {
            return NodeUtils.renderTextSpan("invalid", style, cn(cnArr));
        }
        let text = null;
        try {
            let val = bindVal;
            let formatAttr = ctx.resolveAttrStr("format");
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
        return NodeUtils.renderTextSpan(text, style, cn(cnArr));
    }
}

@mobxReact.observer
class NopNode extends React.Component<HibikiReactProps, {}> {
    render() {
        return null;
    }
}

@mobxReact.observer
class WithContextNode extends React.Component<HibikiReactProps, {}> {
    render() {
        let ctx = new DBCtx(this);
        let contextattr = ctx.resolveAttrStr("context");
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
class ChildrenNode extends React.Component<HibikiReactProps, {}> {
    render() {
        let ctx = new DBCtx(this);
        let textStr = ctx.resolveAttrStr("text");
        if (textStr != null) {
            return textStr;
        }
        let children = ctx.resolveAttrVal("bind");
        if (children != null && !(children instanceof DataCtx.ChildrenVar)) {
            return <ErrorMsg message={sprintf("%s bind expression is not valid, must be [children] type", nodeStr(ctx.node))}/>;
        }
        let cvar : DataCtx.ChildrenVar = children as DataCtx.ChildrenVar;
        let childEnv = (cvar == null ? ctx.dataenv : cvar.dataenv);
        let contextattr = ctx.resolveAttrStr("datacontext");
        if (contextattr != null) {
            try {
                let ctxEnv = DataCtx.ParseAndCreateContextThrow(contextattr, "context", ctx.dataenv, nodeStr(ctx.node));
                childEnv = childEnv.makeChildEnv(ctxEnv.specials, null);
            }
            catch (e) {
                return <ErrorMsg message={nodeStr(ctx.node) + " Error parsing/executing context block: " + e}/>;
            }
        }
        if (cvar == null || cvar.list.length == 0) {
            if (ctx.node.list == null) {
                return null;
            }
            let rtnElems = ctxRenderHtmlChildren(ctx, childEnv);
            if (rtnElems == null) {
                return null;
            }
            return <React.Fragment>{rtnElems}</React.Fragment>;
        }
        let rtnElems = baseRenderHtmlChildren(cvar.list, childEnv, false);
        if (rtnElems == null) {
            return null;
        }
        return <React.Fragment>{rtnElems}</React.Fragment>;
    }
}

@mobxReact.observer
class DynNode extends React.Component<HibikiReactProps, {}> {
    curHtml : string = null;
    curHtmlObj : HibikiNode = null;

    render() {
        let ctx = new DBCtx(this);
        let bindVal = ctx.resolveAttrStr("bind");
        if (bindVal == null) {
            return null;
        }
        if (bindVal != this.curHtml) {
            this.curHtml = bindVal;
            this.curHtmlObj = null;
            try {
                this.curHtmlObj = parseHtml(bindVal);
                bindLibContext(this.curHtmlObj, (ctx.resolveAttrStr("libcontext") ?? "main"));
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

class SimpleQueryNode extends React.Component<HibikiReactProps, {}> {
    refreshCount : mobx.IObservableValue<number>;
    callNum : number = 0;
    autorunDisposer : () => void = null;
    nameComputed : mobx.IComputedValue<string>;

    constructor(props : any) {
        super(props);
        let self = this;
        let ctx = new DBCtx(this);
        this.refreshCount = mobx.observable.box(0, {name: "refreshCount"});
        this.nameComputed = mobx.computed(() => {
            let ctx = new DBCtx(self);
            let name = ctx.resolveAttrStr("name");
            if (name != null) {
                return name;
            }
            return ctx.uuid;
        }, {name: "nameComputed"});
    }

    executeQuery(ctx : DBCtx, curCallNum : number) {
        let dbstate = ctx.dataenv.dbstate;
        let rtctx = new RtContext();
        let name = ctx.resolveAttrStr("name");
        // TODO register handlerName/handlerEnv for error bubbling
        rtctx.pushContext(sprintf("Evaluating %s (in %s)", nodeStr(ctx.node), ctx.dataenv.getFullHtmlContext()), null);
        try {
            let queryStr = ctx.resolveAttrStr("query");
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
                let outputLV = ctx.resolveLValueAttr("output");
                if (outputLV != null) {
                    outputLV.set(queryRtn);
                }
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
        let queryStr = ctx.resolveAttrStr("query");
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
class DashElemNode extends React.Component<{ctx : DBCtx, extClass? : string, extStyle? : any}, {}> {
    render() {
        let ctx = this.props.ctx;
        let cnArr = ctx.resolveCnArray(this.props.extClass);
        let style = ctx.resolveStyleMap(this.props.extStyle);
        return (
            <div className={cn(cnArr, "dashelem")} style={style}>
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
    libNode: {tag: "#def", list: []},
    libComponents: {},
    importedComponents: {},
    localHandlers: {},
    modules: {},
    handlers: {},
};

addCoreComponent("if", IfNode);
addCoreComponent("if-break", IfNode);
addCoreComponent("foreach", FragmentNode);
addCoreComponent("script", ScriptNode);

addCoreComponent("define-vars", NopNode);
addCoreComponent("define-handler", NopNode);
addCoreComponent("define-component", NopNode);
addCoreComponent("import-library", NopNode);

addCoreComponent("h-if", IfNode);
addCoreComponent("h-if-break", IfNode);
addCoreComponent("h-foreach", FragmentNode);
addCoreComponent("h-text", TextNode);
addCoreComponent("h-dateformat", DateFormatNode);
addCoreComponent("h-dyn", DynNode);
addCoreComponent("h-withcontext", WithContextNode);
addCoreComponent("h-children", ChildrenNode);
addCoreComponent("h-data", SimpleQueryNode);
addCoreComponent("h-fragment", FragmentNode);

export {HibikiRootNode, CORE_LIBRARY};
