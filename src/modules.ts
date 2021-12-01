import {isObject} from "./utils";
import {sprintf} from "sprintf-js";
import type {HibikiState} from "./state";
import type {RequestType} from "./types";
import * as DataCtx from "./datactx";

let VALID_METHODS = {"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true};

function DefaultCsrfHook() {
    let csrfToken = null;
    let csrfMwElem = document.querySelector('[name=csrfmiddlewaretoken]');
    if (csrfMwElem != null) {
        csrfToken = (csrfMwElem as any).value;
    }
    let csrfMetaElem = document.querySelector("meta[name=csrf-token]");
    if (csrfMetaElem != null) {
        csrfToken = (csrfMetaElem as any).content;
    }
    if (csrfToken != null) {
        return {
            "X-Csrf-Token": csrfToken,
            "X-CSRFToken": csrfToken,
        };
    }
}

class FetchModule {
    dbstate : HibikiState;
    CsrfHook : () => Record<string, string> = DefaultCsrfHook;
    FetchInitHook : (url : URL, init : Record<string, any>) => void;

    constructor(state : HibikiState) {
        this.dbstate = state;
    }
    
    fetchConfig(url : URL, params : any, init : Record<string, any>) : any {
        init = init || {};
        init.headers = init.headers || new Headers();
        if (this.dbstate.FeClientId) {
            init.headers.set("X-Hibiki-FeClientId", this.dbstate.FeClientId);
        }
        if (this.CsrfHook != null) {
            let csrfHeaders = this.CsrfHook();
            if (csrfHeaders != null) {
                for (let h in csrfHeaders) {
                    init.headers.set(h, csrfHeaders[h]);
                }
            }
        }
        if (!("mode" in init)) {
            // init.mode = "cors";
        }
        if (this.FetchInitHook) {
            this.FetchInitHook(url, init);
        }
        return init;
    }
    
    callHandler(req : RequestType) : Promise<any> {
        let method = req.path.pathfrag;
        if (method == null) {
            throw new Error(sprintf("Invalid null method passed to /@fetch:[method]"));
        }
        // console.log("call-fetch", req.path, req.data);
        method = method.toUpperCase();
        if (!VALID_METHODS[method]) {
            throw new Error(sprintf("Invalid method passed to /@fetch:[method]: '%s'", method));
        }
        let [urlStr, params, initParams] = (req.data ?? []);
        if (urlStr == null || typeof(urlStr) != "string") {
            throw new Error("Invalid call to /@fetch, first argument must be a string (the URL to fetch)");
        }
        let url : URL = null;
        try {
            url = new URL(urlStr);
        }
        catch (e) {
            throw new Error(sprintf("Invalid URL passed to fetch '%s': %s", urlStr, e.toString()));
        }
        if (params != null && !isObject(params)) {
            throw new Error(sprintf("Invalid params passed to /@fetch for url '%s', params must be an object not an array", urlStr));
        }
        let headersObj = new Headers();
        initParams = initParams ?? {};
        if (initParams.headers != null && isObject(initParams.headers)) {
            for (let key in initParams.headers) {
                headersObj.set(key, initParams.headers[key]);
            }
        }
        initParams.headers = headersObj;
        initParams.method = method;
        if (params != null) {
            if (method == "GET" || method == "DELETE") {
                for (let key in params) {
                    let val = params[key];
                    if (val == null || typeof(val) == "function") {
                        continue;
                    }
                    if (typeof(val) == "string" || typeof(val) == "number") {
                        url.searchParams.set(key, val.toString());
                    }
                    else {
                        url.searchParams.set(key, JSON.stringify(val));
                    }
                }
            }
            else {
                initParams.headers.set("Content-Type", "application/json");
                initParams.body = JSON.stringify(params);
            }
        }
        initParams = this.fetchConfig(url, params, initParams);
        let p = fetch(url.toString(), initParams).then((resp) => {
            if (!resp.ok) {
                throw new Error(sprintf("Bad status code response from '%s': %d %s", req.data[0], resp.status, resp.statusText));
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
                                throw new Error("Invalid BLOB returned from fetch, bad mimetype or encoding");
                            }
                            let dbblob = new DataCtx.HibikiBlob();
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
}

export {FetchModule};
