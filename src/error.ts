type RtContextItem = {
    desc : string;
};

class RtContext {
    stack : RtContextItem[];

    constructor() {
        this.stack = [];
    }

    replaceContext(desc : string) {
        this.stack[this.stack.length-1] = {desc: desc};
    }

    getLastContext() : string {
        if (this.stack.length == 0) {
            return null;
        }
        return this.stack[this.stack.length-1].desc;
    }

    pushContext(desc : string) {
        this.stack.push({desc: desc});
    }

    popContext() {
        if (this.stack.length == 0) {
            return;
        }
        this.stack.pop();
    }

    asString() : string {
        return this.stack.map((ctx) => ctx.desc).reverse().join("\n");
    }

    getStackTrace() : string[] {
        return this.stack.reverse().map((ctx) => ctx.desc);
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

type ErrorObj = {
    message : string,
    rtctx? : RtContext,
    err? : Error,
    blockStr? : string,
};

function getShortEMsg(e : any) {
    let emsg = e.toString();
    emsg = emsg.replace(/ Instead, I was(.|\n)*/, "");
    return emsg;
}

export {RtContext, getShortEMsg};
export type {ErrorObj};
