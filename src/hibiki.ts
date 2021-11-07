import {parseHtml} from "./html-parser";
// import {HibikiState, DataEnvironment} from "./state";

declare var window : any;

console.log("hello world!!");

function loadTags() {
    let elems = document.querySelectorAll("hibiki, template[hibiki]");
    for (let i=0; i<elems.length; i++) {
        let elem : HTMLElement = elems[i] as HTMLElement;
        let htmlObj = parseHtml(elem);
        console.log(htmlObj);
    }
}

window.hibiki = {
    loadTags,
//    HibikiState,
//    DataEnvironment,
};
