// Copyright 2021-2022 Dashborg Inc

import {v4 as uuidv4} from 'uuid';
import type {DataEnvironment} from "./state";
import {sprintf} from "sprintf-js";
import type {HibikiNode} from "./types";

type RtContextItem = {
    desc : string,
    handlerName? : string,
    handlerEnv? : DataEnvironment,
    handlerNode? : HibikiNode,
};

type RtContextOpts = {
    handlerName? : string,
    handlerEnv? : DataEnvironment,
    handlerNode? : HibikiNode,
};

function rtItemAsString(rtci : RtContextItem) : string {
    // if (rtci.handlerName != null && rtci.handlerEnv != null) {
    //     return sprintf("[%s %s] %s", rtci.handlerName, rtci.handlerEnv.getFullHtmlContext(), rtci.desc);
    // }
    return rtci.desc;
}

class RtContext {
    rtid : string;
    actionCounter : number;
    stack : RtContextItem[];

    constructor() {
        this.rtid = uuidv4();
        this.actionCounter = 0;
        this.stack = [];
    }

    replaceContext(desc : string, opts : RtContextOpts) {
        opts = opts || {};
        this.stack[this.stack.length-1] = {desc: desc, handlerName: opts.handlerName, handlerEnv: opts.handlerEnv, handlerNode : opts.handlerNode};
    }

    copy() : RtContext {
        let rtn = new RtContext();
        rtn.stack = [...this.stack];
        rtn.actionCounter = this.actionCounter;
        return rtn;
    }

    getTopHandlerContext() : RtContextItem {
        for (let i=this.stack.length-1; i>=0; i--) {
            let item = this.stack[i];
            if (item.handlerName != null && item.handlerEnv != null) {
                return item;
            }
        }
        return null;
    }

    isRunningErrorHandler() : boolean {
        for (let item of this.stack) {
            if (item.handlerName === "error") {
                return true;
            }
        }
        return false;
    }

    isHandlerInStack(env : DataEnvironment, handlerName : string) : boolean {
        for (let i=this.stack.length-1; i>=0; i--) {
            let item = this.stack[i];
            if (item.handlerEnv == null) {
                continue;
            }
            if (item.handlerEnv == env && item.handlerName == handlerName) {
                return true;
            }
        }
        return false;
    }

    getLastContext() : string {
        if (this.stack.length == 0) {
            return null;
        }
        return this.stack[this.stack.length-1].desc;
    }

    pushContext(desc : string, opts : RtContextOpts) {
        opts = opts || {};
        this.stack.push({desc: desc, handlerName: opts.handlerName, handlerEnv: opts.handlerEnv, handlerNode: opts.handlerNode});
    }

    pushErrorContext(err : any) {
        let emsg = err.toString();
        emsg.replaceAll("\n", "\\n");
        if (emsg.length > 80) {
            emsg = emsg.substr(0, 77) + "...";
        }
        this.pushContext(sprintf("Throwing error: <<%s>>", emsg), null);
    }

    popContext() {
        if (this.stack.length == 0) {
            return;
        }
        this.stack.pop();
    }

    asString(indentStr? : string) : string {
        let st = this.getStackTrace();
        if (indentStr != null) {
            st = st.map((s) => indentStr + s);
        }
        return st.join("\n");
    }

    getStackTrace() : string[] {
        return this.stack.slice().reverse().map((ctx) => rtItemAsString(ctx));
    }

    stackSize() : number {
        return this.stack.length;
    }

    revertStack(size : number) {
        if (size < this.stack.length) {
            this.stack.length = size;
        }
    }

    makeCopy() : RtContext {
        let rtn = new RtContext();
        rtn.stack = this.stack.slice();
        return rtn;
    }
}

class HibikiError {
    _type : "HibikiError";
    message : string;
    rtctx : RtContext;
    err : any;
    
    constructor(msg : string, err? : any, rtctx? : RtContext) {
        this._type = "HibikiError";
        this.message = msg;
        this.err = err;
        if (rtctx != null) {
            this.rtctx = rtctx.copy();
        }
    }

    get event() : string {
        if (this.rtctx == null) {
            return null;
        }
        let rtitem = this.rtctx.getTopHandlerContext();
        if (rtitem == null) {
            return null;
        }
        return rtitem.handlerName;
    }

    get node() : HibikiNode {
        if (this.rtctx == null) {
            return null;
        }
        let rtitem = this.rtctx.getTopHandlerContext();
        if (rtitem == null) {
            return null;
        }
        return rtitem.handlerNode;
    }

    get context() : string {
        return this.rtctx.asString();
    }

    get stack() : string {
        let errStr = "Hibiki Error | " + this.message + "\n";
        if (this.rtctx != null) {
            errStr += this.rtctx.asString("> ") + "\n";
        }
        return errStr;
    }

    get jsstack() : string {
        return this.toString();
    }

    toString() : string {
        let errStr = this.stack;
        if (this.err != null && this.err.stack != null) {
            errStr += "\nJavaScript Error: " + this.err.stack + "\n";
        }
        return errStr;
    }
}

function getShortEMsg(e : any) {
    let emsg = e.toString();
    emsg = emsg.replace(/ Instead, I was(.|\n)*/, "");
    return emsg;
}

export {RtContext, getShortEMsg, HibikiError};
