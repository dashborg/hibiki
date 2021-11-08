import * as mobx from "mobx";
import md5 from "md5";
import Axios from "axios";
import {sprintf} from "sprintf-js";
import {boundMethod} from 'autobind-decorator'
import {v4 as uuidv4} from 'uuid';
import {HibikiNode, ComponentType, LibraryType} from "./types";
import * as DataCtx from "./datactx";

import {parseHtml} from "./html-parser";

function unbox(data : any) : any {
    if (mobx.isBoxedObservable(data)) {
        return data.get();
    }
    return data;
}

class DataEnvironment {
    parent : DataEnvironment | null;
    dbstate : HibikiState;
    data : any;
    specials : {[e : string] : any};
    handlers : {[e : string] : {handlerStr: string, parentEnv: boolean}};
    onlySpecials : boolean;
    componentRoot : {[e : string] : any};
    htmlContext : string;
    description : string;

    constructor(dbstate : HibikiState, data : any, opts? : DataEnvironmentOpts) {
        this.parent = null;
        this.dbstate = dbstate;
        this.data = data;
        this.specials = {};
        this.handlers = {};
        this.onlySpecials = false;
        if (opts != null) {
            this.componentRoot = opts.componentRoot;
            this.description = opts.description;
            this.handlers = opts.handlers || {};
        }
    }

    getHtmlContext() : string {
        if (this.htmlContext != null) {
            return this.htmlContext;
        }
        if (this.parent == null) {
            return "none";
        }
        return this.parent.getHtmlContext();
    }

    getRootDataEnv() : DataEnvironment {
        let rtn : DataEnvironment = this;
        while (rtn.parent != null) {
            rtn = rtn.parent;
        }
        return rtn;
    }

    resolveRoot(rootName : string, opts?: {caret? : number}) : any {
        opts = opts || {};
        if (opts.caret != null && opts.caret < 0 || opts.caret > 1) {
            throw "Invalid caret value, must be 0 or 1";
        }
        if (rootName == "global" || rootName == "data") {
            return unbox(this.dbstate.DataRoots["global"]);
        }
        if (rootName == "state") {
            return unbox(this.dbstate.DataRoots["state"]);
        }
        if (rootName == "local") {
            if (opts.caret) {
                let localstack = this.getLocalStack();
                if (localstack.length <= opts.caret) {
                    return null;
                }
                return localstack[opts.caret];
            }
            return this.data;
        }
        if (rootName == "null") {
            return null;
        }
        if (rootName == "nodedata") {
            return this.dbstate.NodeDataMap;
        }
        if (rootName == "context") {
            let ref : DataEnvironment = this;
            if (opts.caret) {
                for (let i=0; i<opts.caret && ref != null; i++) {
                    ref = ref.parent;
                }
            }
            if (ref == null) {
                return null;
            }
            return ref.getContextProxy();
        }
        if (rootName == "currentcontext") {
            let ref : DataEnvironment = this;
            if (opts.caret) {
                for (let i=0; i<opts.caret && ref != null; i++) {
                    ref = ref.parent;
                }
            }
            if (ref == null) {
                return null;
            }
            return ref.specials;
        }
        if (rootName == "localstack") {
            return this.getLocalStack();
        }
        if (rootName == "contextstack") {
            return this.getContextStack();
        }
        if (rootName == "c" || rootName == "component") {
            return this.getComponentRoot();
        }
        else {
            if (rootName in this.dbstate.DataRoots) {
                return unbox(this.dbstate.DataRoots[rootName]);
            }
            throw "Invalid root path";
        }
    }

    getContextProxy() : {[e : string] : any} {
        let self = this;
        let traps = {
            get: (obj : any, prop : (string | number | symbol)) : any => {
                if (prop == null) {
                    return null;
                }
                if (prop == SYM_PROXY) {
                    return true;
                }
                if (prop == SYM_FLATTEN) {
                    return self.getSquashedContext();
                }
                return self.getContextKey(prop.toString());
            },
            set: (obj : any, prop : string, value : any) : boolean => {
                if (prop == null) {
                    return true;
                }
                self.specials[prop] = value;
                return true;
            },
        };
        return new Proxy({}, traps);
    }

    getSquashedContext() : {[e : string] : any} {
        let stack = this.getContextStack();
        let rtn = {};
        for (let i=stack.length-1; i>=0; i--) {
            Object.assign(rtn, stack[i]);
        }
        return rtn;
    }

    getHandlerAndEnv(handlerName : string) : {handler: string, dataenv: DataEnvironment} {
        if (handlerName in this.handlers) {
            let hval = this.handlers[handlerName];
            let env : DataEnvironment = this;
            if (hval.parentEnv && this.parent != null) {
                env = this.parent;
            }
            return {handler: hval.handlerStr, dataenv: env};
        }
        if (this.parent == null) {
            return null;
        }
        return this.parent.getHandlerAndEnv(handlerName);
    }

    getContextKey(contextkey : string) : any {
        if (contextkey in this.specials) {
            return this.specials[contextkey];
        }
        if (this.parent == null) {
            return null;
        }
        return this.parent.getContextKey(contextkey);
    }

    makeLValue(path : string) : DataCtx.LValue {
        let lv = DataCtx.ParseLValuePath(path, this);
        return lv;
    }

    getComponentRoot() : {[e : string] : any} {
        if (this.componentRoot != null) {
            return this.componentRoot;
        }
        if (this.parent == null) {
            return null;
        }
        return this.parent.getComponentRoot();
    }

    getLocalStack() : any[] {
        let dataenv : DataEnvironment = this;
        let rtn = [];
        while (true) {
            if (dataenv == null) {
                break;
            }
            if (!dataenv.onlySpecials) {
                rtn.push(dataenv.data);
            }
            dataenv = dataenv.parent;
        }
        return rtn;
    }

    getContextStack() : any[] {
        let dataenv : DataEnvironment = this;
        let rtn = [];
        while (true) {
            if (dataenv == null) {
                break;
            }
            rtn.push(dataenv.specials);
            dataenv = dataenv.parent;
        }
        return rtn;
    }

    makeChildEnv(data : any, specials? : any, opts? : DataEnvironmentOpts) : DataEnvironment {
        specials = specials || {};
        let rtn = new DataEnvironment(this.dbstate, data, opts);
        rtn.parent = this;
        let copiedSpecials = Object.assign({}, specials || {});
        rtn.specials = copiedSpecials;
        return rtn;
    }

    makeSpecialChildEnv(specials : any, opts? : DataEnvironmentOpts) : DataEnvironment {
        let rtn = this.makeChildEnv(this.data, specials, opts);
        rtn.onlySpecials = true;
        return rtn;
    }

    resolvePath(path : string, keepMobx? : boolean) : any {
        let rtn = DataCtx.ResolvePath(path, this);
        if (!keepMobx) {
            rtn = DataCtx.demobx(rtn);
        }
        return rtn;
    }

    setDataPath(path : string, value : any) {
        this.dbstate.setDataPath(path, value);
    }

    evalExpr(expr : string, keepMobx? : boolean) : any {
        if (expr == null || expr == "") {
            return null;
        }
        let rtn = DataCtx.EvalSimpleExpr(expr, this);
        if (!keepMobx) {
            rtn = DataCtx.demobx(rtn);
        }
        return rtn;
    }
}

function DefaultCsrfHook() {
    let csrfToken = null;
    let csrfMwElem = document.querySelector('[name=csrfmiddlewaretoken]');
    if (csrfMwElem != null) {
        csrfToken = (csrfMwElem as any).value;
    }
    let csrfMetaElem = document.querySelector("meta[name=csrf-token]");
    if (csrfMetaElem != null) {
        csrfToken = (csrfMetaTag as any).content;
    }
    return {
        "X-Csrf-Token": csrfToken,
        "X-CSRFToken": csrfToken,
    };
}

class ComponentLibrary {
    libs : Record<string, LibraryType> = {};          // name -> library
    components : Record<string, ComponentType> = {};  // name -> component

    addLibrary(libObj : LibraryType) {
        this.libs[libObj.name] = libObj;
    }

    buildLib(libName : string, htmlobj : HibikiNode, clear : boolean) {
        if (this.libs[libName] == null || clear) {
            this.libs[libName] = {name: libName, components: {}};
        }
        let libObj = this.libs[libName];
        if (htmlobj == null || htmlobj.list == null) {
            return;
        }
        for (let h of htmlobj.list) {
            if (h.tag != "define-component") {
                continue;
            }
            if (!h.attrs || !h.attrs["name"]) {
                console.log("define-component tag without a name, skipping");
                continue;
            }
            let name = h.attrs["name"];
            if (libObj.components[name]) {
                console.log(sprintf("cannot redefine component %s/%s", libName, name));
                continue;
            }
            libObj.components[name] = {componentType: "hibiki-html", node: h, libName: libName, name: name};
        }
    }

    importLib(libName : string, prefix : string) {
        let libObj = this.libs[libName];
        if (libObj == null) {
            console.log("ERROR invalid component library", libName);
            return;
        }
        for (let name in libObj.components) {
            if (name.startsWith("@")) {
                continue;
            }
            let newComp = libObj.components[name];
            let cpath = libName + ":" + name;
            let importName = (prefix == null ? "" : prefix + "-") + name;
            let origComp = this.components[importName];
            if (origComp != null && (origComp.libName != newComp.libName || origComp.name != newComp.name)) {
                console.log(sprintf("Conflicting import %s %s:%s (discarding %s:%s)", importName, origComp.libName, origComp.name, newComp.libName, newComp.name));
                continue;
            }
            this.components[importName] = newComp;
        }
    }

    findComponent(tagName : string) : ComponentType {
        return this.components[tagName];
    }
}

class HibikiState {
    FeClientId : string = null;
    Ui : string = null;
    ErrorCallback : (any) => void;
    HtmlObj : mobx.IObservableValue<any> = mobx.observable.box(null, {name: "HtmlObj", deep: false});
    ComponentLibrary : ComponentLibrary;
    Loading : mobx.IObservableValue<boolean> = mobx.observable.box(true, {name: "Loading"});
    RenderVersion : mobx.IObservableValue<number> = mobx.observable.box(0, {name: "RenderVersion"});
    DataNodeStates = {};
    ScriptCache = {};
    PostScriptRunQueue : any[] = [];
    HasRendered = false;
    ScriptsLoaded : mobx.IObservableValue<boolean> = mobx.observable.box(false, {name: "ScriptsLoaded"});
    NodeDataMap : Map<string, mobx.IObservableValue<any>> = new Map();  // TODO clear on unmount
    
    Modules : {[e : string] : HibikiHandlerModule} = {};
    CsrfHook : () => Record<string, string> = DefaultCsrfHook;
    FetchInitHook : (url : string, init : Record<string, any>) => void;
    
    DataRoots : Record<string, mobx.IObservableValue<any>>;

    constructor(config : HibikiConfig) {
        this.DataRoots = {};
        this.DataRoots["global"] = mobx.observable.box({}, {name: "GlobalData"})
        this.DataRoots["state"] = mobx.observable.box({}, {name: "AppState"})
        this.ComponentLibrary = new ComponentLibrary();
    }

    fetchConfig(url : string, init? : {[e : string] : any}) : any {
        init = init || {};
        init.headers = init.headers || {};
        if (this.FeClientId) {
            headers["X-Dashborg-FeClientId"] = this.FeClientId;
        }
        if (this.CsrfHook != null) {
            let csrfHeaders = this.CsrfHook();
            for (let h in csrfHeaders) {
                init.headers[h] = csrfHeaders[h];
            }
        }
        if (!("credentials" in init)) {
            init.credentials = "include";
        }
        if (!("mode" in init)) {
            init.mode = "cors";
        }
        if (this.FetchInitHook) {
            this.FetchInitHook(url, init);
        }
        return init;
    }

    axiosConfig() : any {
        let headers = {};
        if (this.FeClientId) {
            headers["X-Dashborg-FeClientId"] = this.FeClientId;
        }
        if (this.CsrfHook != null) {
            let csrfHeaders = this.CsrfHook();
            for (let h in csrfHeaders) {
                headers[h] = csrfHeaders[h];
            }
        }
        return {
            headers: headers,
            withCredentials: true,
        };
    }

    @mobx.action setHtml(htmlobj : HibikiNode) {
        this.HtmlObj.set(htmlobj);
        this.ComponentLibrary.buildLib("local", htmlobj, true);
        this.ComponentLibrary.importLib("local", "local");
    }

    rootDataenv() : DataEnvironment {
        return new DataEnvironment(this, null, {description: "root"});
    }

    @mobx.action fireScriptsLoaded() {
        let dataenv = this.rootDataenv();
        this.ScriptsLoaded.set(true);
        DataCtx.SetPath("$state.dashborg.scriptsloaded", dataenv, true);
        while (this.PostScriptRunQueue.length > 0) {
            let fn = this.PostScriptRunQueue.shift();
            try {
                fn();
            }
            catch (e) {
                console.log("ERROR in PostScriptRunQueue", e);
            }
        }
    }

    queuePostScriptRunFn(fn : any) {
        if (this.ScriptsLoaded.get()) {
            setTimeout(fn, 1);
            return;
        }
        this.PostScriptRunQueue.push(fn);
    }

    externalServerLoc() : string {
        if (this.EmbedEnv == "dev" || window.location.hostname == "test.localdev") {
            return "https://console.dashborg-dev.com:8080";
        }
        return "https://console.dashborg.net";
    }

    @mobx.action setDataPath(path : string, data : any) {
        let dataenv = this.rootDataenv();
        DataCtx.SetPath(path, dataenv, data);
    }

    initialLoad() {
        this.doLoadPanel(null);
    }

    destroyPanel() {
        console.log("destroy panel state", this.getAppUrl());
        if (this.DrainDisposer != null) {
            this.DrainDisposer();
        }
    }

    findPage(pageName? : string) : HibikiNode {
        if (pageName == null || pageName == "") {
            pageName = "default";
        }
        let htmlobj = this.HtmlObj.get();
        if (htmlobj == null || htmlobj.list == null) {
            return null;
        }
        let starTag = null;
        let hasDefs = false;
        for (let h of htmlobj.list) {
            if (h.tag == "page" || h.tag == "define-component") {
                hasDefs = true;
            }
            if (h.tag == "page") {
                let tagNameAttr = "default";
                if (h.attrs) {
                    tagNameAttr = h.attrs["name"] ?? h.attrs["appname"] ?? "default";
                }
                if (tagNameAttr == pageName) {
                    return h;
                }
                if (tagNameAttr == "*" && starTag == null) {
                    starTag = h;
                }
            }
        }
        if (starTag != null) {
            return starTag;
        }
        if (!hasDefs) {
            return htmlobj;
        }
        return null;
    }

    findComponent(componentName : string) : any {
        let htmlobj = this.PanelHtmlObj.get();
        if (htmlobj == null || htmlobj.list == null) {
            return null;
        }
        for (let h of htmlobj.list) {
            if (h.tag == "define-component" && h.attrs != null && h.attrs["name"] == componentName) {
                return h;
            }
        }
        return null;
    }

    findLocalHandler(handlerName : string) : any {
        let htmlobj = this.PanelHtmlObj.get();
        if (htmlobj == null || htmlobj.list == null) {
            return null;
        }
        for (let h of htmlobj.list) {
            if ((h.tag == "define-handler") && h.attrs != null && h.attrs["name"] == handlerName) {
                return h;
            }
        }
        return null;
    }

    // opts: rtContext, dataenv
    runLocalHandler(handlerHtml : any, handlerData : any[], opts? : any) : Promise<any> {
        if (opts == null) {
            opts = {};
        }
        let handlerText = textContent(handlerHtml);
        console.log("run local handler", handlerHtml, handlerText, handlerData);
        let rtctx = null;
        if (opts.rtContext != null) {
            rtctx = opts.rtContext;
        }
        if (rtctx == null) {
            rtctx = new RtContext();
        }
        let dataenv = opts.dataenv;
        if (dataenv == null) {
            dataenv = this.rootDataenv();
        }
        let contextDataenv = dataenv.makeSpecialChildEnv({params: handlerData});
        rtctx.pushContext(sprintf("Running @local handler '%s'", handlerHtml.attrs.name));
        let p = DataCtx.ParseAndExecuteBlock(handlerText, null, contextDataenv, rtctx);
        return p;
    }

    findScript(scriptName : string) : any {
        let htmlobj = this.PanelHtmlObj.get();
        if (htmlobj == null || htmlobj.list == null) {
            return null;
        }
        for (let h of htmlobj.list) {
            if ((h.tag == "script" || h.tag == "d-script") && h.attrs != null && h.attrs["name"] == scriptName) {
                return h;
            }
        }
        return null;
    }

    @mobx.action doLoadPanel(challengeData : any) {
        this.stopStreaming(true);
        this.StreamStopped.set(false);
        let self = this;
        let dataenv = this.rootDataenv();
        let paramsObj = smartParseUrlParams();
        let dashjwt = paramsObj["_dashjwt"];
        delete paramsObj["_dbe"];
        delete paramsObj["_dashjwt"];
        if (dashjwt != null) {
            fixJwtUrl(["_dashjwt"]);
        }
        DataCtx.SetPath("$state.dashborg.apppage", dataenv, this.PageName);
        DataCtx.SetPath("$state.urlparams", dataenv, paramsObj);
        if (this.PostParams) {
            DataCtx.SetPath("$state.postparams", dataenv, this.PostParams);
        }
        if (this.Embed) {
            DataCtx.SetPath("$state.dashborg.embed", dataenv, true);
        }
        if (this.ParentApp != null) {
            DataCtx.SetPath("$state.dashborg.parentapp", dataenv, this.ParentApp);
        }
        let config = this.axiosConfig();
        config.headers["Content-Type"] = "application/json";
        let postData = {
            zonename: this.ZoneName,
            panelname: this.PanelName,
            panelstate: DataCtx.demobx(DataCtx.ResolvePath("$state", dataenv)),
            dashjwt: dashjwt,
            challengedata: null,
            embedauthtoken: null,
        };
        if (this.EmbedAuthToken) {
            postData.embedauthtoken = this.EmbedAuthToken;
        }
        if (challengeData != null) {
            postData.challengedata = challengeData;
        }
        let jsonData = DataCtx.JsonStringify(postData);
        let localHtmlRR = null;
        
        if (this.LocalHtml != null && this.LocalHtml.trim() != "") {
            localHtmlRR = {
                type: "html",
                ts: Date.now(),
                reqid: uuidv4(),
                html: this.LocalHtml,
            };
        }
        console.log("load app %s %s", this.AccId, this.getAppUrl());
        if (this.PlaygroundHandlers != null) {
            this.queueScriptText(this.PlaygroundHandlers, true);
        }
        if (this.AccId == "local") {
            let fullDataP : Promise<any> = null;
            if (window.DashborgService && window.DashborgService.hasHandler(this.PanelName, "handler", "/")) {
                let rtnDataP = window.DashborgService.dispatchRequest(this.PanelName, "handler", "/");
                fullDataP = Promise.resolve(rtnDataP)
                    .then((rtnData) => {
                        let fullData = {
                            success: true,
                            data: rtnData,
                        };
                        fullData.data.rra = fullData.data.rra || [];
                        return fullData;
                    });
            }
            else {
                let fullData = {
                    success: true,
                    data: {
                        feclientid: uuidv4(),
                        rra: [],
                    },
                };
                fullDataP = Promise.resolve(fullData);
            }
            fullDataP
                .then((fullData) => {
                    if (localHtmlRR != null) {
                        fullData.data.rra.unshift(localHtmlRR);
                    }
                    return fullData;
                })
                .then((fullData) => this.convertRRAHtmlChain(fullData, true))
                .then((fullData) => {
                    this.handleHandlerResponse(fullData, true);
                    return null;
                })
                .catch((e) => {
                    self.reportError("Error loading panel[" + this.PanelName + "]: " + e)
                })
                .finally(() => {
                    self.Loading.set(false);
                });
            console.log("LOCAL loadPanel", this.PanelName);
            return;
        }

        Axios.post(this.serverLoc() + "/api2/load-panel", jsonData, config)
             .then(jsonRespHandler)
             .then((fullData) => {
                 if (localHtmlRR != null && fullData && fullData.data) {
                     fullData.data.rra = fullData.data.rra || [];
                     fullData.data.rra.unshift(localHtmlRR);
                 }
                 return fullData;
             })
             .then((fullData) => this.convertRRAHtmlChain(fullData, true))
             .then((fullData) => {
                 self.handleHandlerResponse(fullData, true);
             })
             .catch((e) => {
                 self.reportError("Error loading panel[" + this.PanelName + "]: " + e);
             })
             .finally(() => {
                 self.Loading.set(false);
             });
    }

    @mobx.action handleHandlerResponse(fullData : any, loadPanel : boolean) : any {
        // console.log("got resp", (loadPanel ? "load-panel" : "handler"), fullData);
        
        let data = fullData.data;
        data.rra = data.rra || [];
        let hasHtml = hasHtmlRR(data.rra);
        if (loadPanel) {
            this.AuthChallenge.clear();
            this.PanelData.set(this.InitialData || {});
            this.WizardState.set({});
            this.PanelErrCode.set(null);
            this.PanelErrMsg.set(data.errmsg);
            this.PanelInitErr.set(null);
            this.AccInfo.set(data.accinfo || {});
            this.FeClientId = data.feclientid;
            this.AuthInfo.set(data.authinfo);
            if (data.errcode != null && data.errcode != "") {
                if (data.errcode == "INITERROR" || data.errcode == "INITERR") {
                    this.PanelErrCode.set(data.errcode);
                    this.PanelInitErr.set(data.initerr);
                }
                else {
                    this.PanelErrCode.set(data.errcode);
                }
                // allow PanelErrCode to fall-through -- this allows "html" to be set from local panel
            }
            if (data.appinfo != null) {
                if (data.appinfo.apptitle != null) {
                    DataCtx.SetPath("setunless:$state.dashborg.apptitle", this.rootDataenv(), data.appinfo.apptitle);
                }
                if (data.appinfo.appconnected != null) {
                    this.AppConnected.set(data.appinfo.appconnected);
                    DataCtx.SetPath("$state.dashborg.appconnected", this.rootDataenv(), data.appinfo.appconnected);
                }
                this.AppInfo.set(data.appinfo);
                if (data.appinfo.pagesenabled) {
                    let appPage = this.getAppPage();
                    DataCtx.SetPath("$state.dashborg.htmlpage", this.rootDataenv(), appPage);
                }
                else {
                    DataCtx.SetPath("$state.dashborg.htmlpage", this.rootDataenv(), data.appinfo.htmlpage);
                }
            }
            if (this.PanelName.startsWith("/")) {
                DataCtx.SetPath("$state.dashborg.fspath", this.rootDataenv(), this.PanelName);
            }
            if (data.fileinfo != null) {
                DataCtx.SetPath("$state.dashborg.fileinfo", this.rootDataenv(), data.fileinfo);
            }
        }
        if (hasHtml) {
            this.PanelHtmlObj.set(null);
            this.DataNodeStates = {};
            this.RenderVersion.set(this.RenderVersion.get() + 1);
        }
        let htmlRR = [];
        for (let rr of data.rra) {
            if (rr.type == "html") {
                if (rr.data == null || rr.data.htmlobj == null || rr.data.htmlobj.list == null) {
                    console.log("response htmlobj is null");
                    continue;
                }
                htmlRR.push(rr);
                continue;
            }
            else if (loadPanel && rr.type == "panelauthchallenge") {
                this.AuthChallenge.push(rr.data);
                continue;
            }
            else if (rr.type == "error") {
                if (loadPanel) {
                    this.reportError("Load Panel Error: " + rr.err);
                }
                else {
                    this.reportError("Handler Error: " + rr.err);
                }
            }
        }
        let rtnVal = this.processRRA(data.rra, data.reqid, null);
        if (htmlRR.length > 0) {
            setTimeout(mobx.action(() => {
                let pho = this.PanelHtmlObj.get();
                for (let rr of htmlRR) {
                    if (pho == null) {
                        pho = rr.data.htmlobj;
                    }
                    else {
                        pho.list.push(...rr.data.htmlobj.list);
                    }
                }
                this.PanelHtmlObj.set(pho);
            }), 5);
        }
        setTimeout(this.handleRemoveParams, 10);
        return rtnVal;
    }

    callLocalData(localHandlerName : string, handlerData : any[]) : Promise<any> {
        if (!window.DashborgService) {
            return Promise.reject("Cannot dispatch @local data call, no DashborgService defined: " + localHandlerName);
        }
        try {
            let respPromise = window.DashborgService.dispatchRequest(this.PanelName, "data", localHandlerName, handlerData);
            return Promise.resolve(respPromise);
        }
        catch(e) {
            return Promise.reject("Error calling @local data handler " + localHandlerName + ": " + e);
        }
    }

    callFetch(method : string, data : any[]) : Promise<any> {
        console.log("call-fetch", method, data);
        if (method == null) {
            throw sprintf("Invalid null method passed to /@fetch:[method]");
        }
        method = method.toUpperCase();
        if (!VALID_METHODS[method]) {
            throw sprintf("Invalid method passed to /@fetch:[method]: '%s'", method);
        }
        if (data == null || data.length == 0 || typeof(data[0]) != "string") {
            throw sprintf("Invalid call to /@fetch, first argument must be a string, the URL to fetch");
        }
        let initParams : any = {};
        if (data.length >= 2 && data[1] != null) {
            initParams = data[1];
        }
        initParams.method = method;
        let p = fetch(data[0], initParams).then((resp) => {
            if (!resp.ok) {
                throw sprintf("Bad status code response from '%s': %d %s", data[0], resp.status, resp.statusText);
            }
            let contentType = resp.headers.get("Content-Type");
            if (contentType != null && contentType.startsWith("application/json")) {
                return resp.json();
            }
            else {
                let blobp = resp.blob();
                return blobp.then((blob) => {
                    return new Promise((resolve, _) => {
                        let reader = new FileReader();
                        reader.onloadend = () => {
                            let mimetype = blob.type;
                            let semiIdx = (reader.result as string).indexOf(";");
                            if (semiIdx == -1 || mimetype == null || mimetype == "") {
                                throw "Invalid BLOB returned from fetch, bad mimetype or encoding";
                            }
                            let dbblob = new DataCtx.DashborgBlob();
                            dbblob.mimetype = blob.type;
                            // extra 7 bytes for "base64," ... e.g. data:image/jpeg;base64,[base64data]
                            dbblob.data = (reader.result as string).substr(semiIdx+1+7);
                            resolve(dbblob);
                        };
                        reader.readAsDataURL(blob);
                    });
                });
            }
        });
        return p;
    }

    callData(handlerPath : string, handlerData : any[]) : Promise<any> {
        if (handlerPath == null || handlerPath == "") {
            return Promise.resolve(null);
        }
        let hpath = parseHandler(handlerPath);
        if (hpath == null) {
            throw "Invalid handler path: " + handlerPath;
        }
        if (hpath.ns == "" && this.AccId == "local") {
            hpath.ns = "local";
        }
        if (hpath.ns == "local") {
            if (hpath.path != "/" || hpath.pathfrag == "") {
                throw "Invalid local data call, format as /@local:[handler-name]";
            }
            return this.callLocalData(hpath.pathfrag, handlerData);
        }
        if (hpath.ns == "fetch") {
            return this.callFetch(hpath.pathfrag, handlerData);
        }
        if (hpath.ns != "" && hpath.ns != "app" && hpath.ns != "self") {
            throw "Invalid handler namespace: " + handlerPath;
        }
        let dataenv = this.rootDataenv();
        let postData = {
            zonename: this.ZoneName,
            panelname: this.PanelName,
            path: handlerPath,
            panelstate: DataCtx.demobx(DataCtx.ResolvePath("$state", dataenv)),
            data: handlerData,
        };
        let jsonData = DataCtx.JsonStringify(postData);
        let self = this;
        let config = this.axiosConfig();
        config.headers["Content-Type"] = "application/json";
        console.log("call data-handler", handlerPath, handlerData);
        return Axios.post(this.serverLoc() + "/api2/data", jsonData, config).then(jsonRespHandler).then((fullData) => {
            return self.processRRA(fullData.data, null);
        });
    }

    applyRRA(rr : any, isStreaming : boolean, dataenv : DataEnvironment) {
        DataCtx.ApplySingleRRA(dataenv, rr);
    }

    @mobx.action processRRA(rra : any, reqid : string, opts? : any) : any {
        if (rra == null) {
            return null;
        }
        let rtnval = null;
        opts = opts || {};
        let dataenv = this.rootDataenv();
        for (let rr of rra) {
            if (rr.type == "setdata" && rr.selector == "@rtn") {
                rtnval = rr.data;
                continue;
            }
            else if (rr.type == "blob" && rr.selector == "@rtn") {
                rtnval = DataCtx.BlobFromRRA(rr);
                continue;
            }
            else if (rr.type == "blobext" && rr.selector == "@rtn") {
                if (rtnval == null || !(rtnval instanceof DashborgBlob)) {
                    console.log("Bad blobext:@rtn, no DashborgBlob to extend");
                    continue;
                }
                DataCtx.ExtBlobFromRRA(rtnval, rr);
            }
            else if (rr.type == "invalidate") {
                this.invalidateRegex(rr.selector);
            }
            else if (rr.type == "html") {
                let htmlObj = parseHtml(rr.data);
                if (htmlObj != null) {
                    this.HtmlObj.set(htmlObj);
                }
            }
            this.applyRRA(rr, opts.isDrain, dataenv);
        }
        return rtnval;
    }

    // opts rtContext, dataenv
    async callLocalHandlerAsync(localHandlerName : string, handlerData : any, opts? : any) : Promise<any> {
        let localHandler = this.findLocalHandler(localHandlerName);
        if (localHandler != null) {
            return this.runLocalHandler(localHandler, handlerData, opts);
        }
        if (!window.DashborgService) {
            return Promise.reject("Cannot dispatch @local handler call, no DashborgService defined");
        }
        try {
            let respPromise = window.DashborgService.dispatchRequest(this.PanelName, "handler", localHandlerName, handlerData);
            let rtnP = Promise.resolve(respPromise).then((respData) => {
                if (respData && respData.rra && respData.rra.length > 0) {
                    return this.processRRA(respData.rra, respData.reqid);
                }
                else {
                    return null;
                }
            });
            return rtnP;
        }
        catch(e) {
            return Promise.reject("Error calling @local handler " + localHandlerName + ": " + e);
        }
    }

    // opts: rtContext, dataenv
    async callHandlerAsync(handlerPath : string, handlerData : any[], opts? : any) : Promise<any> {
        if (handlerPath == null || handlerPath == "") {
            throw "Invalid handler path"
        }
        let hpath = parseHandler(handlerPath);
        if (hpath == null) {
            throw "Invalid handler path: " + handlerPath;
        }
        if (hpath.ns == "" && this.AccId == "local") {
            hpath.ns = "local";
        }
        if (hpath.ns == "local") {
            if (hpath.path != "/" || hpath.pathfrag == "") {
                throw "Invalid local handler call, format as /@local:[handler-name]";
            }
            return this.callLocalHandlerAsync(hpath.pathfrag, handlerData, opts);
        }
        if (hpath.ns != "" && hpath.ns != "app" && hpath.ns != "self") {
            throw "Invalid handler namespace: " + handlerPath;
        }
        opts = opts || {};
        let dataenv = this.rootDataenv();
        let postData = {
            zonename: this.ZoneName,
            panelname: this.PanelName,
            path: handlerPath,
            data: handlerData,
            panelstate: DataCtx.demobx(DataCtx.ResolvePath("$state", dataenv)),
        };
        let lvMap = {};
        let jsonData = DataCtx.JsonStringifyForCall(lvMap, postData)
        console.log("call handler", handlerPath, handlerData, lvMap);
        let self = this;
        let config = this.axiosConfig();
        config.headers["Content-Type"] = "application/json";
        let p = Axios.post(this.serverLoc() + "/api2/call-handler", jsonData, config)
                     .then(jsonRespHandler)
                     .then((fullData) => this.convertRRAHtmlChain(fullData, false))
                     .then((fullData) => {
                         return self.handleHandlerResponse(fullData, false);
                     });
        return p;
    }

    // opts: rtContext, dataenv
    callHandler(handlerPath : string, handlerData : any[], opts? : any) : Promise<any> {
        try {
            let self = this;
            let handlerP = this.callHandlerAsync(handlerPath, handlerData, opts);
            let prtn = handlerP.catch((e) => {
                self.reportErrorObj({
                    message: "Error calling handler " + handlerPath + ": " + e,
                    err: e,
                    rtctx: opts.rtContext,
                });
                console.log(e);
            });
            return prtn;
        }
        catch (e) {
            this.reportErrorObj({
                message: "Error calling handler " + handlerPath + ": " + e,
                err: e,
                rtctx: opts.rtContext,
            });
            return null;
        }
    }

    reportError(errorMessage : string, rtctx? : RtContext) {
        if (this.ErrorCallback == null) {
            console.log("Dashborg Panel Error", errorMessage);
            return;
        }
        let msg : ErrorObj = {message: errorMessage, rtctx: rtctx};
        this.ErrorCallback(msg);
    }

    reportErrorObj(errorObj : ErrorObj) {
        if (this.ErrorCallback == null) {
            console.log("Dashborg Panel Error", errorObj);
            return;
        }
        this.ErrorCallback(errorObj);
    }

    registerDataNodeState(uuid : string, query : string, dnstate : any) {
        this.DataNodeStates[uuid] = {query: query, dnstate: dnstate};
    }

    unregisterDataNodeState(uuid : string) {
        delete this.DataNodeStates[uuid];
    }

    @mobx.action invalidate(query : string) {
        for (let uuid in this.DataNodeStates) {
            let dnq = this.DataNodeStates[uuid];
            if (dnq.query != query) {
                continue;
            }
            dnq.dnstate.forceRefresh();
        }
    }

    @mobx.action invalidateRegex(queryReStr : string) {
        let queryRe = new RegExp(queryReStr);
        for (let uuid in this.DataNodeStates) {
            let dnq = this.DataNodeStates[uuid];
            if (!dnq.query.match(queryRe)) {
                continue;
            }
            dnq.dnstate.forceRefresh();
        }
    }

    @mobx.action invalidateAll() {
        for (let uuid in this.DataNodeStates) {
            let dnq = this.DataNodeStates[uuid];
            dnq.dnstate.forceRefresh();
        }
    }

    queueScriptSrc(scriptSrc : string, sync : boolean) {
        // console.log("queue script src", scriptSrc);
        let srcMd5 = md5(scriptSrc);
        if (this.ScriptCache[srcMd5]) {
            return;
        }
        this.ScriptCache[srcMd5] = true;
        let scriptElem = document.createElement("script");
        if (sync) {
            scriptElem.async = false;
        }
        scriptElem.src = scriptSrc;
        document.querySelector("body").appendChild(scriptElem);
    }

    queueScriptText(text : string, sync : boolean) {
        // console.log("queue script", text);
        let textMd5 = md5(text);
        if (this.ScriptCache[textMd5]) {
            return;
        }
        this.ScriptCache[textMd5] = true;
        let dataUri = "data:text/javascript;base64," + btoa(text);
        this.queueScriptSrc(dataUri, sync);
    }
}

const STYLE_UNITLESS_NUMBER = { // from react
    "animation-iteration-count": true,
    "border-image-outset": true,
    "border-image-slice": true,
    "border-image-width": true,
    "box-flex": true,
    "box-flex-group": true,
    "box-ordinal-group": true,
    "column-count": true,
    columns: true,
    flex: true,
    "flex-grow": true,
    "flex-positive": true,
    "flex-shrink": true,
    "flex-negative": true,
    "flex-order": true,
    "grid-row": true,
    "grid-row-end": true,
    "grid-row-span": true,
    "grid-row-start": true,
    "grid-column": true,
    "grid-column-end": true,
    "grid-column-span": true,
    "grid-column-start": true,
    "font-weight": true,
    "line-clamp": true,
    "line-height": true,
    opacity: true,
    order: true,
    orphans: true,
    tabsize: true,
    widows: true,
    "z-index": true,
    zoom: true,

    // svg-related properties
    "fill-opacity": true,
    "flood-opacity": true,
    "stop-opacity": true,
    "stroke-dasharray": true,
    "stroke-dashoffset": true,
    "stroke-miterlimit": true,
    "stroke-opacity": true,
    "stroke-width": true,
};

// return type is not necessarily string :/
function resolveAttrVal(k : string, v : string, dataenv : DataEnvironment, opts : any) : string {
    opts = opts || {};
    if (v == null || v == "") {
        return null;
    }
    if (!v.startsWith("*")) {
        return v;
    }
    v = v.substr(1);
    let rtContext = opts.rtContext || sprintf("Resolving Attribute '%s'", k);
    let resolvedVal = DataCtx.EvalSimpleExpr(v, dataenv, rtContext);
    if (resolvedVal instanceof DataCtx.LValue) {
        resolvedVal = resolvedVal.get();
    }
    if (opts.raw) {
        return resolvedVal;
    }
    if (resolvedVal == null || resolvedVal === false || resolvedVal == "") {
        return null;
    }
    if (resolvedVal === true) {
        resolvedVal = 1;
    }
    if (k == "blobsrc" && resolvedVal instanceof DashborgBlob) {
        return (resolvedVal as any);
    }
    if (opts.style && typeof(resolvedVal) == "number") {
        if (!STYLE_UNITLESS_NUMBER[k]) {
            resolvedVal = String(resolvedVal) + "px";
        }
    }
    return String(resolvedVal);
}

function getAttributes(node : HibikiNode, dataenv : DataEnvironment, opts? : any) : any {
    if (node.attrs == null) {
        return {};
    }
    opts = opts || {};
    let rtn = {};
    for (let [k,v] of Object.entries(node.attrs)) {
        opts.rtContext = sprintf("Resolving attribute '%s' in <%s>", k, node.tag);
        let rval = resolveAttrVal(k, v, dataenv, opts);
        if (rval == null) {
            continue;
        }
        rtn[k] = rval;
    }
    return rtn;
}

function getAttribute(node : HibikiNode, attrName : string, dataenv : DataEnvironment, opts? : any) : any {
    if (!node || !node.attrs || node.attrs[attrName] == null) {
        return null;
    }
    opts = opts || {};
    opts.rtContext = sprintf("Resolving attribute '%s' in <%s>", attrName, node.tag);
    let val = node.attrs[attrName];
    let rval = resolveAttrVal(attrName, val, dataenv, opts);
    if (rval == null) {
        return null;
    }
    return rval;
}

const STYLE_KEY_MAP = {
    "bold": {key: "fontWeight", val: "bold"},
    "italic": {key: "fontStyle", val: "italic"},
    "underline": {key: "textDecoration", val: "underline"},
    "strike": {key: "textDecoration", val: "line-through"},
    "pre": {key: "whiteSpace", val: "pre"},
    "fixedfont": {key: "fontFamily", val: "\"courier new\", fixed"},
    "grow": {key: "flex", val: "1 0 0"},
    "noshrink": {key: "flexShrink", val: "0"},
    "shrink": {key: "flexShrink", val: "1"},
    "scroll": {key: "overflow", val: "scroll"},
    "center": {flex: true, key: "justifyContent", val: "center"},
    "xcenter": {flex: true, key: "alignItems", val: "center"},
    "fullcenter": {flex: true},
};

function getStyleMap(node : HibikiNode, styleName : string, dataenv : DataEnvironment, initStyles? : any) : any {
    let rtn = initStyles || {};
    let styleMap : {[v : string] : string}= null;
    if (styleName == "style") {
        styleMap = node.style;
    } else {
        if (node.morestyles != null) {
            styleMap = node.morestyles[styleName];
        }
    }
    if (styleMap == null) {
        return rtn;
    }
    for (let [k,v] of Object.entries(styleMap)) {
        let opts = {
            style: true,
            rtContext: sprintf("Resolve style property '%s' in attribute '%s' in <%s>", k, styleName, node.tag),
        };
        let rval = resolveAttrVal(k, v, dataenv, opts);
        if (rval == null) {
            continue;
        }
        let skm = STYLE_KEY_MAP[k];
        if (skm != null) {
            if (skm.flex) {
                rtn.display = "flex";
            }
            if (k == "fullcenter") {
                rtn.justifyContent = "center";
                rtn.alignItems = "center";
                continue;
            }
            rtn[skm.key] = skm.val;
            continue;
        }
        rtn[k] = rval;
    }
    return rtn;
}

export {HibikiState, DataEnvironment, getAttributes, getAttribute, getStyleMap};
