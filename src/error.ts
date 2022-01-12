// Copyright 2021 Dashborg Inc

import type {DataEnvironment} from "./state";
import {sprintf} from "sprintf-js";

type RtContextItem = {
    desc : string,
    handlerName? : string,
    handlerEnv? : DataEnvironment,
};

type RtContextOpts = {
    handlerName? : string,
    handlerEnv? : DataEnvironment,
};

function rtItemAsString(rtci : RtContextItem) : string {
    // if (rtci.handlerName != null && rtci.handlerEnv != null) {
    //     return sprintf("[%s %s] %s", rtci.handlerName, rtci.handlerEnv.getFullHtmlContext(), rtci.desc);
    // }
    return rtci.desc;
}

class RtContext {
    stack : RtContextItem[];

    constructor() {
        this.stack = [];
    }

    replaceContext(desc : string, opts : RtContextOpts) {
        opts = opts || {};
        // console.log("RT-REPLACE", this.stack.length, this.stack[this.stack.length-1].desc, "=>", desc);
        this.stack[this.stack.length-1] = {desc: desc, handlerName: opts.handlerName, handlerEnv: opts.handlerEnv};
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
        // console.log("RT-PUSH", this.stack.length+1, desc);
        this.stack.push({desc: desc, handlerName: opts.handlerName, handlerEnv: opts.handlerEnv});
    }

    pushErrorContext(err : any) {
        let emsg = err.toString();
        emsg.replaceAll("\n", "\\n");
        if (emsg.length > 80) {
            emsg = emsg.substr(0, 77) + "...";
        }
        this.pushContext(sprintf("throw error: <<%s>>", emsg), null);
    }

    popContext() {
        if (this.stack.length == 0) {
            return;
        }
        this.stack.pop();
        // console.log("RT-POP", this.stack.length);
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
        // console.log("RT-REVERT", this.stack.length, "=>", size);
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
    event? : string;
    
    constructor(msg : string, err? : any, rtctx? : RtContext) {
        this._type = "HibikiError";
        this.message = msg;
        this.err = err;
        this.rtctx = rtctx;
    }

    get context() : string {
        return this.rtctx.asString();
    }

    toString() : string {
        let errStr = "Hibiki Error | " + this.message + "\n";
        if (this.rtctx != null) {
            errStr += this.rtctx.asString("> ") + "\n";
        }
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
