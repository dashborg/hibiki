import {parseHtml} from "./html-parser";
import {HibikiState, DataEnvironment} from "./state";
import * as ReactDOM from "react-dom";
import {HibikiRootNode, CORE_LIBRARY} from "./nodes";

declare var window : any;

function initialize(hibikiRoot : HTMLElement, html : string | HTMLElement, rootData : any) {
    let htmlObj = parseHtml(html);
    let state = new HibikiState();
    state.setHtml(htmlObj);
    state.ComponentLibrary.addLibrary(CORE_LIBRARY);
    state.ComponentLibrary.importLib("@dashborg/core", null);
    state.DataRoots["global"].set(rootData);
    let renderNode = state.findPage("default");
    let reactElem = React.createElement(HibikiRootNode, {node: renderNode, dataenv: state.rootDataenv()}, null);
    ReactDOM.render(reactElem, hibikiRoot);
    window.HibikiState = state;
}

function loadTags() {
    let elems = document.querySelectorAll("hibiki, template[hibiki]");
    for (let i=0; i<elems.length; i++) {
        let elem : HTMLElement = elems[i] as HTMLElement;
        if (elem.tagName.toLowerCase() == "template") {
            let siblingNode = document.createElement("div");
            siblingNode.classList.add("hibiki-root");
            elem.parentNode.insertBefore(siblingNode, elem.nextSibling); // insertAfter
            initialize(siblingNode, elem, {"test": [1,3,5], "color": "purple"});
        }
        else {
            initialize(elem, elem, null);
        }
    }
}

window.hibiki = {
    loadTags,
    HibikiState,
    DataEnvironment,
};
