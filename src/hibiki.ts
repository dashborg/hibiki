import {parseHtml} from "./html-parser";
import {HibikiState, DataEnvironment} from "./state";
import * as ReactDOM from "react-dom";
import {RootNode} from "./nodes";

declare var window : any;

function loadTags() {
    let elems = document.querySelectorAll("hibiki, template[hibiki]");
    for (let i=0; i<elems.length; i++) {
        let elem : HTMLElement = elems[i] as HTMLElement;
        let htmlObj = parseHtml(elem);
        let state = new HibikiState();
        state.setHtml(htmlObj);
        window.HibikiState = state;
        let renderNode = state.findPage("default");
        let reactElem = React.createElement(RootNode, {node: renderNode, dataenv: state.rootDataenv()}, null);

        console.log(elem.tagName);
        if (elem.tagName.toLowerCase() == "template") {
            let siblingNode = document.createElement("div");
            siblingNode.classList.add("hibiki-root");
            elem.parentNode.insertBefore(siblingNode, elem.nextSibling); // insertAfter
            ReactDOM.render(reactElem, siblingNode);
        }
        else {
            ReactDOM.render(reactElem, elem);
        }
    }
}

window.hibiki = {
    loadTags,
    HibikiState,
    DataEnvironment,
};
