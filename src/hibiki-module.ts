// Copyright 2021-2022 Dashborg Inc

import {sprintf} from "sprintf-js";
import * as DataCtx from "./datactx";
import type {HibikiRequest} from "./request";
import {unpackPositionalArgs, stripAtKeys, getHibiki, fullPath, getSS, setSS, unpackArg, unpackAtArgs, smartEncodeParam, validateModulePath, unpackPositionalArgArray} from "./utils";
import type {HibikiExtState} from "./types";
import type {HibikiState} from "./state";
import {RtContext} from "./error";

function hibikiState(state : HibikiExtState) : HibikiState {
    return ((state as any).state as HibikiState);
}

class HibikiModule {
    state : HibikiState;

    constructor(state : HibikiState, config : any) {
        this.state = state;
    }

    callHandler(req : HibikiRequest) : Promise<any> {
        validateModulePath("hibiki", req.callpath);
        let handlerName = req.callpath.url;
        if (handlerName == "/get-session-storage") {
            return this.getSS(req);
        }
        else if (handlerName == "/set-session-storage") {
            return this.setSS(req);
        }
        else if (handlerName == "/set-title") {
            return this.setTitle(req);
        }
        else if (handlerName == "/update-url") {
            return this.updateUrl(req);
        }
        else if (handlerName == "/sleep") {
            return this.sleep(req);
        }
        else if (handlerName == "/navigate") {
            return this.navigate(req);
        }
        else if (handlerName == "/setTimeout") {
            return this.setTimeout(req);
        }
        else if (handlerName == "/setInterval") {
            return this.setInterval(req);
        }
        else if (handlerName == "/clearInterval") {
            return this.clearInterval(req);
        }
        else {
            throw new Error("Invalid Hibiki Module handler: " + fullPath(req.callpath));
        }
    }

    sleep(req : HibikiRequest) : Promise<any> {
        let sleepMs = unpackArg(req.data, "ms", 0);
        if (sleepMs == null || typeof(sleepMs) !== "number") {
            throw new Error("sleep requires 'ms' parameter (must be number)");
        }
        return new Promise((resolve, reject) => {
            setTimeout(() => resolve(true), sleepMs);
        });
    }

    getSS(req : HibikiRequest) : Promise<any> {
        let key = unpackArg(req.data, "key", 0);
        if (key == null) {
            throw new Error("get-session-storage requires 'key' parameter");
        }
        return getSS(key);
    }

    setSS(req : HibikiRequest) : Promise<any> {
        let key = unpackArg(req.data, "key", 0);
        if (key == null) {
            throw new Error("set-session-storage requires 'key' parameter");
        }
        let val = DataCtx.demobx(unpackArg(req.data, "value", 1));
        setSS(key, val);
        return null;
    }

    setTitle(req : HibikiRequest) : Promise<any> {
        let title = unpackArg(req.data, "title", 0);
        if (title == null) {
            throw new Error("set-title requires 'title' parameter");
        }
        document.title = String(title);
        req.setData("$state.title", document.title);
        return null;
    }

    updateUrl(req : HibikiRequest) : Promise<any> {
        let data = stripAtKeys(req.data);
        let {path: urlStr, raw: isRaw, replace, title} = unpackAtArgs(req.data);
        let url = new URL((urlStr ?? ""), window.location.href);
        for (let key in data) {
            let val = data[key];
            if (val == null) {
                url.searchParams.delete(key);
                continue;
            }
            url.searchParams.set(key, smartEncodeParam(val, isRaw));
        }
        if (title != null) {
            document.title = title;
        }
        if (replace) {
            window.history.replaceState(null, document.title, url.toString());
        }
        else {
            window.history.pushState(null, document.title, url.toString());
        }
        hibikiState(req.state).setStateVars();
        return null;
    }

    navigate(req : HibikiRequest) : Promise<any> {
        let data = stripAtKeys(req.data);
        let {path: urlStr, raw: isRaw} = unpackAtArgs(req.data);
        let url = new URL((urlStr ?? ""), window.location.href);
        for (let key in data) {
            let val = data[key];
            if (val == null) {
                url.searchParams.delete(key);
                continue;
            }
            url.searchParams.set(key, smartEncodeParam(val, isRaw));
        }
        // @ts-ignore (you definitely can set window.location to a string)
        window.location = url.toString();
        return null;
    }

    setTimeout(req : HibikiRequest) : Promise<any> {
        let posArgs = unpackPositionalArgArray(req.data);
        if (posArgs.length != 2 || typeof(posArgs[0]) !== "string" || typeof(posArgs[1]) !== "number") {
            throw new Error("Invalid call to setTimeout.  You must provide two positional args setTimeout(eventName : string, timeoutMs : number).");
        }
        let eventName = posArgs[0];
        let timeoutMs = posArgs[1];
        let datacontext = stripAtKeys(req.data);
        let timeoutId = setTimeout(() => {
            let state = hibikiState(req.state);
            let eventObj = {event: eventName, native: true, bubble: false, datacontext: datacontext};
            let rtctx = new RtContext();
            rtctx.pushContext(sprintf("Firing '%s' event (from setTimeout)", eventName), null);
            DataCtx.FireEvent(eventObj, req.dataenv, rtctx, true);
        }, timeoutMs);
        return Promise.resolve(timeoutId as any);
    }

    setInterval(req : HibikiRequest) : Promise<any> {
        let posArgs = unpackPositionalArgArray(req.data);
        if (posArgs.length != 2 || typeof(posArgs[0]) !== "string" || typeof(posArgs[1]) !== "number") {
            throw new Error("Invalid call to setInterval.  You must provide two positional args setInterval(eventName : string, intervalMs : number).");
        }
        let eventName = posArgs[0];
        let intervalMs = posArgs[1];
        let datacontext = stripAtKeys(req.data);
        let intervalId = setInterval(() => {
            let state = hibikiState(req.state);
            let eventObj = {event: eventName, native: true, bubble: false, datacontext: datacontext};
            let rtctx = new RtContext();
            rtctx.pushContext(sprintf("Firing '%s' event (from setTimeout)", eventName), null);
            DataCtx.FireEvent(eventObj, req.dataenv, rtctx, true);
        }, intervalMs);
        return Promise.resolve(intervalId as any);
    }

    clearInterval(req : HibikiRequest) : Promise<any> {
        let posArgs = unpackPositionalArgArray(req.data);
        if (posArgs.length != 1) {
            throw new Error("Invalid call to clearInterval.  You must provide one positional arg setInterval(intervalId).  intervalId is returned from //@hibiki/setInterval()");
        }
        clearInterval(posArgs[0] as any);
        return null;
    }
}

export {HibikiModule};
