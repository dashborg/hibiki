// Generated automatically by nearley, version 2.20.1
// http://github.com/Hardmath123/nearley
(function () {
function id(x) { return x[0]; }


let moo = require("moo");

let ESCAPES = {
    "n": "\n",
    "b": "\b",
    "f": "\f",
    "r": "\r",
    "t": "\t",
    "v": "\v",
};

function strEscValue(val) {
    let ch = val[1];
    if (ESCAPES[ch]) {
        return ESCAPES[ch];
    }
    return ch;
}

// we define the URLPATH token to accept a superset of valid URLs and module URLs to prevent
// weird lexing tokens.  parseUrl will sort out the invalid URLs later
//
// method            = (?:(?:GET|POST|PUT|PATCH|DELETE|DYN)\s+)
// prefix            = (?:http:|https:|\/\/)
// maxurl            = [^(); \t\r\n]+
//
// URLPATH = method maxurl | prefix maxurl

let lexer = moo.states({
    main: {
        URLPATH: { match: /(?:(?:GET|POST|PUT|PATCH|DELETE|DYN)\s+)[^(); \t\r\n]+|(?:http:|https:|\/\/)[^(); \t\r\n]+/ },
        SPACESHIP:   "<=>",
        LOGICAL_OR:  "||",
        LOGICAL_AND: "&&",
        GEQ:         ">=",
        LEQ:         "<=",
        EQEQ:        "==",
        BANGEQ:      "!=",
        QQ:          "??",
        DOTDOT:      "..",
        DASHGT:      "->",
        LT:          "<",
        GT:          ">",
        COMMENT:     { match: /\/\*[^]*?\*\// },
        DOLLAR:   "$",
        ATID:     { match: /@[a-zA-Z][a-zA-Z_0-9]*/, value: (v) => v.substr(1) },
        ATSIGN:   "@",
        FN:       { match: /fnx?:[a-zA-Z_][a-zA-Z_0-9]*/ },
        ID:       { match: /[a-zA-Z_][a-zA-Z_0-9]*/,
                    type: moo.keywords({
                        KW_TRUE: "true",
                        KW_FALSE: "false",
                        KW_NULL: "null",
                        KW_NOATTR: "noattr",
                        KW_ISNOATTR: "isnoattr",
                        KW_CALLHANDLER: "callhandler",
                        KW_SETRETURN: "setreturn",
                        KW_RETURN: "return",
                        KW_INVALIDATE: "invalidate",
                        KW_FIRE: "fire",
                        KW_NOP: "nop",
                        KW_LOG: "log",
                        KW_EXPR: "expr",
                        KW_LOCAL: "local",
                        KW_IF: "if",
                        KW_ELSE: "else",
                        KW_THROW: "throw",
                        KW_REF: "ref",
                        KW_ISREF: "isref",
                        KW_REFINFO: "refinfo",
                        KW_RAW: "raw",
                        KW_IN: "in",
                        KW_INVOKE: "invoke",
                        KW_LAMBDA: "lambda",
                    }),
                  },
        LBRACK:   "[",
        RBRACK:   "]",
        LPAREN:   "(",
        RPAREN:   ")",
        LBRACE:   "{",
        RBRACE:   "}",
        COLON:    ":",
        COMMA:    ",",
        STAR:     "*",
        DOUBLE_STAR: "**",
        CARET:    "^",
        SLASH:    "/",
        PERCENT:  "%",
        BANG:     "!",
        QUESTION: "?",
        PLUS:     "+",
        DASH:     "-",
        HASH:     "#",
        SEMI:     ";",
        EQUAL:    "=",
        PIPE:     "|",
        JSNUM:       { match: /[0-9]*\.?[0-9]+/, value: (v) => parseFloat(v) },
        DOT:      ".",
        STRSTART_DQ: {match: "\"", push: "dqstring"},
        STRSTART_SQ: {match: "'", push: "sqstring"},
        WS:          { match: /\s+/, lineBreaks: true },
    },
    dqstring: {
        STRPART: /[^"\\\n]+/,   // "
        STRESC:  {match: /\\./, value: strEscValue},
        STREND:  {match: "\"", pop: 1},
    },
    sqstring: {
        STRPART: /[^'\n]+/,
        STREND: {match: "'", pop: 1},
    },
    
});

let origNext = lexer.next.bind(lexer);
lexer.next = () => {
    while (true) {
        let tok = origNext();
        if (tok && (tok.type == "WS" || tok.type == "COMMENT")) {
            continue;
        }
        return tok;
    }
}

var grammar = {
    Lexer: lexer,
    ParserRules: [
    {"name": "ext_fullExpr", "symbols": ["fullExpr"], "postprocess": id},
    {"name": "ext_statementBlock", "symbols": ["statementBlock"], "postprocess": id},
    {"name": "ext_callStatementNoAssign", "symbols": ["callStatementNoAssign"], "postprocess": id},
    {"name": "ext_contextAssignList", "symbols": ["contextAssignList"], "postprocess": id},
    {"name": "ext_refAttribute", "symbols": ["refAttribute"], "postprocess": id},
    {"name": "ext_pathExprNonTerm", "symbols": ["pathExprNonTerm"], "postprocess": id},
    {"name": "ext_iteratorExpr", "symbols": ["iteratorExpr"], "postprocess": id},
    {"name": "fullExpr", "symbols": ["filterExpr"], "postprocess": id},
    {"name": "statementBlock$ebnf$1", "symbols": ["anyStatement"]},
    {"name": "statementBlock$ebnf$1", "symbols": ["statementBlock$ebnf$1", "anyStatement"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "statementBlock", "symbols": ["statementBlock$ebnf$1"], "postprocess":  (data) => {
            let rtn = data[0].filter((v) => (v != null));
            return rtn;
        } },
    {"name": "anyStatement", "symbols": [(lexer.has("SEMI") ? {type: "SEMI"} : SEMI)], "postprocess": (data) => null},
    {"name": "anyStatement", "symbols": ["statement", (lexer.has("SEMI") ? {type: "SEMI"} : SEMI)], "postprocess": (data) => data[0]},
    {"name": "anyStatement", "symbols": ["statementNoSemi"], "postprocess": id},
    {"name": "lastStatement$ebnf$1", "symbols": [(lexer.has("SEMI") ? {type: "SEMI"} : SEMI)], "postprocess": id},
    {"name": "lastStatement$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "lastStatement", "symbols": ["statement", "lastStatement$ebnf$1"], "postprocess": (data) => data[0]},
    {"name": "lastStatement", "symbols": ["statementNoSemi"], "postprocess": id},
    {"name": "statementNoSemi", "symbols": ["ifStatement"], "postprocess": id},
    {"name": "iteratorExpr", "symbols": [(lexer.has("ATID") ? {type: "ATID"} : ATID), (lexer.has("KW_IN") ? {type: "KW_IN"} : KW_IN), "fullExpr"], "postprocess":  
        (data) => ({data: data[2], itemvar: data[0].value}) 
              },
    {"name": "iteratorExpr$ebnf$1$subexpression$1", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA), (lexer.has("ATID") ? {type: "ATID"} : ATID)]},
    {"name": "iteratorExpr$ebnf$1", "symbols": ["iteratorExpr$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "iteratorExpr$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "iteratorExpr", "symbols": [(lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), (lexer.has("ATID") ? {type: "ATID"} : ATID), "iteratorExpr$ebnf$1", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN), (lexer.has("KW_IN") ? {type: "KW_IN"} : KW_IN), "fullExpr"], "postprocess":  (data) => {
            let rtn = {data: data[5], itemvar: data[1].value};
            if (data[2] != null) {
                rtn.keyvar = data[2][1].value;
            }
            return rtn;
        } },
    {"name": "statement", "symbols": ["callStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["assignmentStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["invalidateStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["fireStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["logStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["exprStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["throwStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["returnStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["nopStatement"], "postprocess": id},
    {"name": "throwStatement", "symbols": [(lexer.has("KW_THROW") ? {type: "KW_THROW"} : KW_THROW), "callParamsSingle"], "postprocess": (data) => ({actiontype: "throw", data: data[1]})},
    {"name": "returnStatement", "symbols": [(lexer.has("KW_SETRETURN") ? {type: "KW_SETRETURN"} : KW_SETRETURN), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullExpr", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess": (data) => ({actiontype: "setreturn", data: data[2], exithandler: false})},
    {"name": "returnStatement$ebnf$1", "symbols": ["fullExpr"], "postprocess": id},
    {"name": "returnStatement$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "returnStatement", "symbols": [(lexer.has("KW_RETURN") ? {type: "KW_RETURN"} : KW_RETURN), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "returnStatement$ebnf$1", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess": (data) => ({actiontype: "setreturn", data: data[2], exithandler: true})},
    {"name": "returnStatement", "symbols": [(lexer.has("KW_RETURN") ? {type: "KW_RETURN"} : KW_RETURN)], "postprocess": (data) => ({actiontype: "setreturn", data: null, exithandler: true})},
    {"name": "ifStatement$ebnf$1$subexpression$1", "symbols": [(lexer.has("KW_ELSE") ? {type: "KW_ELSE"} : KW_ELSE), (lexer.has("LBRACE") ? {type: "LBRACE"} : LBRACE), "statementBlock", (lexer.has("RBRACE") ? {type: "RBRACE"} : RBRACE)]},
    {"name": "ifStatement$ebnf$1", "symbols": ["ifStatement$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "ifStatement$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "ifStatement", "symbols": [(lexer.has("KW_IF") ? {type: "KW_IF"} : KW_IF), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullExpr", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN), (lexer.has("LBRACE") ? {type: "LBRACE"} : LBRACE), "statementBlock", (lexer.has("RBRACE") ? {type: "RBRACE"} : RBRACE), "ifStatement$ebnf$1"], "postprocess":  (data) => {
            let rtn = {actiontype: "ifblock", data: data[2], actions: {}};
            rtn.actions["then"] = data[5];
            if (data[7] != null) {
                rtn.actions["else"] = data[7][2];
            }
            return rtn;
        } },
    {"name": "callStatement$ebnf$1$subexpression$1", "symbols": ["lvalue", (lexer.has("EQUAL") ? {type: "EQUAL"} : EQUAL)]},
    {"name": "callStatement$ebnf$1", "symbols": ["callStatement$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "callStatement$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "callStatement", "symbols": ["callStatement$ebnf$1", "callStatementNoAssign"], "postprocess":  (data) => {
            if (data[0]) {
                let lvalueArr = data[0][0];
                data[1].setpath = lvalueArr[1];
                data[1].setop = lvalueArr[0];
            }
            return data[1];
        } },
    {"name": "callStatementNoAssign", "symbols": ["staticCallStatement"], "postprocess": id},
    {"name": "callStatementNoAssign", "symbols": ["dynCallStatement"], "postprocess": id},
    {"name": "dynCallStatement", "symbols": [(lexer.has("KW_CALLHANDLER") ? {type: "KW_CALLHANDLER"} : KW_CALLHANDLER), "namedCallParams"], "postprocess":  (data) => {
            return {actiontype: "callhandler", data: data[1]};
        } },
    {"name": "staticCallStatement", "symbols": [(lexer.has("URLPATH") ? {type: "URLPATH"} : URLPATH), "namedCallParams"], "postprocess":  (data) => {
            let callpath = {etype: "literal", val: data[0].value};
            let rtn = {actiontype: "callhandler", callpath: callpath, data: data[1]};
            return rtn;
        } },
    {"name": "contextAssignKey", "symbols": ["idOrKeyword"], "postprocess": (data) => data[0].value},
    {"name": "contextAssignKey", "symbols": ["stringLit"], "postprocess": (data) => data[0]},
    {"name": "contextAssignKey", "symbols": [(lexer.has("ATID") ? {type: "ATID"} : ATID)], "postprocess": (data) => data[0].value},
    {"name": "contextAssignPart", "symbols": ["contextAssignKey", (lexer.has("EQUAL") ? {type: "EQUAL"} : EQUAL), "fullExpr"], "postprocess":  (data) => {
              return {key: data[0], expr: data[2]};
        } },
    {"name": "commaOrSemi", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA)]},
    {"name": "commaOrSemi", "symbols": [(lexer.has("SEMI") ? {type: "SEMI"} : SEMI)]},
    {"name": "contextAssignList$ebnf$1", "symbols": []},
    {"name": "contextAssignList$ebnf$1$subexpression$1", "symbols": ["commaOrSemi", "contextAssignPart"]},
    {"name": "contextAssignList$ebnf$1", "symbols": ["contextAssignList$ebnf$1", "contextAssignList$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "contextAssignList$ebnf$2", "symbols": ["commaOrSemi"], "postprocess": id},
    {"name": "contextAssignList$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "contextAssignList", "symbols": ["contextAssignPart", "contextAssignList$ebnf$1", "contextAssignList$ebnf$2"], "postprocess":  (data) => {
              let rtn = [data[0]];
              rtn.push(...data[1].map((v) => v[1]));
              return rtn;
        } },
    {"name": "namedParamKey", "symbols": ["idOrKeyword"], "postprocess": (data) => ({etype: "literal", val: data[0].value})},
    {"name": "namedParamKey", "symbols": ["stringLit"], "postprocess": (data) => ({etype: "literal", val: data[0]})},
    {"name": "namedParamKey", "symbols": [(lexer.has("ATID") ? {type: "ATID"} : ATID)], "postprocess": (data) => ({etype: "literal", val: "@" + data[0].value})},
    {"name": "namedParamKey", "symbols": [(lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullExpr", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess": (data) => data[1]},
    {"name": "namedParamPart", "symbols": ["namedParamKey", (lexer.has("EQUAL") ? {type: "EQUAL"} : EQUAL), "fullExpr"], "postprocess":  (data) => {
            return {etype: "kv", key: data[0], valexpr: data[2]};
        } },
    {"name": "namedParamList$ebnf$1", "symbols": []},
    {"name": "namedParamList$ebnf$1$subexpression$1", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA), "namedParamPart"]},
    {"name": "namedParamList$ebnf$1", "symbols": ["namedParamList$ebnf$1", "namedParamList$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "namedParamList", "symbols": ["namedParamPart", "namedParamList$ebnf$1"], "postprocess":  (data) => {
            let kwExprs = [];
            kwExprs.push(data[0]);
            kwExprs.push(...data[1].map((v) => v[1]));
            return {etype: "map", exprs: kwExprs};
        } },
    {"name": "namedCallParams", "symbols": [], "postprocess": (data) => { return null; }},
    {"name": "namedCallParams$ebnf$1", "symbols": ["innerNamedCallParams"], "postprocess": id},
    {"name": "namedCallParams$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "namedCallParams", "symbols": [(lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "namedCallParams$ebnf$1", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess": (data) => { return data[1]; }},
    {"name": "innerNamedCallParams", "symbols": ["literalArrayElements"], "postprocess":  (data) => {
            let arrData = {etype: "array", exprs: data[0]};
            let argsExpr = {etype: "kv", key: {etype: "literal", val: "*args"}, valexpr: arrData};
            let mapData = {etype: "map", exprs: [argsExpr]};
            return mapData;
        } },
    {"name": "innerNamedCallParams", "symbols": ["namedParamList"], "postprocess": (data) => { return data[0]; }},
    {"name": "innerNamedCallParams", "symbols": ["literalArrayElementsNoComma", (lexer.has("COMMA") ? {type: "COMMA"} : COMMA), "namedParamList"], "postprocess":  (data) => {
            let arrData = {etype: "array", exprs: data[0]};
            let mapData = data[2];
            let argsExpr = {etype: "kv", key: {etype: "literal", val: "*args"}, valexpr: arrData};
            mapData.exprs.push(argsExpr);
            return mapData;
        } },
    {"name": "callParams$ebnf$1", "symbols": ["literalArrayElements"], "postprocess": id},
    {"name": "callParams$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "callParams", "symbols": [(lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "callParams$ebnf$1", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess": (data) => data[1]},
    {"name": "callParamsSingle$ebnf$1", "symbols": ["fullExpr"], "postprocess": id},
    {"name": "callParamsSingle$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "callParamsSingle", "symbols": [(lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "callParamsSingle$ebnf$1", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess": (data) => data[1]},
    {"name": "assignmentStatement", "symbols": ["lvalue", (lexer.has("EQUAL") ? {type: "EQUAL"} : EQUAL), "fullExpr"], "postprocess":  (data) => {
            return {actiontype: "setdata", setpath: data[0][1], setop: data[0][0], data: data[2]};
        } },
    {"name": "exprStatement", "symbols": [(lexer.has("KW_EXPR") ? {type: "KW_EXPR"} : KW_EXPR), "fullExpr"], "postprocess": (data) => ({actiontype: "setdata", data: data[1]})},
    {"name": "invalidateStatement", "symbols": [(lexer.has("KW_INVALIDATE") ? {type: "KW_INVALIDATE"} : KW_INVALIDATE), "namedCallParams"], "postprocess":  (data) => {
            if (data[1] == null) {
                return {actiontype: "invalidate"};
            }
            return {actiontype: "invalidate", data: data[1]};
        } },
    {"name": "nopStatement$ebnf$1$subexpression$1", "symbols": [(lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)]},
    {"name": "nopStatement$ebnf$1", "symbols": ["nopStatement$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "nopStatement$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "nopStatement", "symbols": [(lexer.has("KW_NOP") ? {type: "KW_NOP"} : KW_NOP), "nopStatement$ebnf$1"], "postprocess": (data) => ({actiontype: "nop"})},
    {"name": "fireStatement$ebnf$1$subexpression$1", "symbols": ["idOrKeyword", (lexer.has("COLON") ? {type: "COLON"} : COLON)]},
    {"name": "fireStatement$ebnf$1", "symbols": ["fireStatement$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "fireStatement$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "fireStatement", "symbols": [(lexer.has("KW_FIRE") ? {type: "KW_FIRE"} : KW_FIRE), (lexer.has("DASHGT") ? {type: "DASHGT"} : DASHGT), "fireStatement$ebnf$1", "idOrKeyword", "namedCallParams"], "postprocess":  (data) => {
            let eventName = data[3].value;
            if (data[2] != null) {
                eventName = data[2][0].value + ":" + eventName;
            }
            let rtn = {actiontype: "fireevent", event: {etype: "literal", val: eventName}, data: data[4]};
            return rtn;
        } },
    {"name": "logStatement", "symbols": [(lexer.has("KW_LOG") ? {type: "KW_LOG"} : KW_LOG), "namedCallParams"], "postprocess": (data) => ({actiontype: "log", data: data[1]})},
    {"name": "lvalue$ebnf$1$subexpression$1", "symbols": ["idOrKeyword", (lexer.has("COLON") ? {type: "COLON"} : COLON)]},
    {"name": "lvalue$ebnf$1", "symbols": ["lvalue$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "lvalue$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "lvalue", "symbols": ["lvalue$ebnf$1", "lvaluePath"], "postprocess":  (data) => {
            let setop = "set";
            if (data[0] != null) {
                setop = data[0][0].value;
            }
            return [setop, data[1]];
        } },
    {"name": "lvaluePath", "symbols": ["pathExprNonTerm"], "postprocess": (data) => data[0].path},
    {"name": "refAttribute", "symbols": ["fullPathExpr"], "postprocess": (data) => ({etype: "ref", pathexpr: data[0]})},
    {"name": "fullPathExpr", "symbols": ["ternaryPathExpr"], "postprocess": id},
    {"name": "ternaryPathExpr", "symbols": [(lexer.has("KW_NOATTR") ? {type: "KW_NOATTR"} : KW_NOATTR)], "postprocess": (data) => ({etype: "noattr"})},
    {"name": "ternaryPathExpr", "symbols": [(lexer.has("KW_NULL") ? {type: "KW_NULL"} : KW_NULL)], "postprocess": (data) => ({etype: "literal", val: null})},
    {"name": "ternaryPathExpr", "symbols": ["pathExprNonTerm"], "postprocess": id},
    {"name": "ternaryPathExpr", "symbols": ["fullExpr", (lexer.has("QUESTION") ? {type: "QUESTION"} : QUESTION), "fullPathExpr", (lexer.has("COLON") ? {type: "COLON"} : COLON), "fullPathExpr"], "postprocess":  (data) => {
            return {etype: "op", op: "?:", exprs: [data[0], data[2], data[4]]};
        } },
    {"name": "filterExpr", "symbols": ["ternaryExpr"], "postprocess": id},
    {"name": "filterExpr", "symbols": ["ternaryExpr", (lexer.has("PIPE") ? {type: "PIPE"} : PIPE), "idOrKeyword", "namedCallParams"], "postprocess":  (data) => {
            return {etype: "filter", filter: data[2].value, params: data[3], exprs: [data[0]]};
        } },
    {"name": "ternaryExpr", "symbols": ["qqExpr"], "postprocess": id},
    {"name": "ternaryExpr", "symbols": ["qqExpr", (lexer.has("QUESTION") ? {type: "QUESTION"} : QUESTION), "fullExpr", (lexer.has("COLON") ? {type: "COLON"} : COLON), "ternaryExpr"], "postprocess": (data) => ({etype: "op", op: "?:", exprs: [data[0], data[2], data[4]]})},
    {"name": "qqExpr", "symbols": ["logicalOrExpr"], "postprocess": id},
    {"name": "qqExpr", "symbols": ["qqExpr", (lexer.has("QQ") ? {type: "QQ"} : QQ), "logicalOrExpr"], "postprocess": (data) => ({etype: "op", op: "??", exprs: [data[0], data[2]]})},
    {"name": "logicalOrExpr", "symbols": ["logicalAndExpr"], "postprocess": id},
    {"name": "logicalOrExpr", "symbols": ["logicalOrExpr", (lexer.has("LOGICAL_OR") ? {type: "LOGICAL_OR"} : LOGICAL_OR), "logicalAndExpr"], "postprocess": (data) => ({etype: "op", op: "||", exprs: [data[0], data[2]]})},
    {"name": "logicalAndExpr", "symbols": ["equalityExpr"], "postprocess": id},
    {"name": "logicalAndExpr", "symbols": ["logicalAndExpr", (lexer.has("LOGICAL_AND") ? {type: "LOGICAL_AND"} : LOGICAL_AND), "equalityExpr"], "postprocess": (data) => ({etype: "op", op: "&&", exprs: [data[0], data[2]]})},
    {"name": "equalityExpr", "symbols": ["relationalExpr"], "postprocess": id},
    {"name": "equalityExpr", "symbols": ["equalityExpr", (lexer.has("EQEQ") ? {type: "EQEQ"} : EQEQ), "relationalExpr"], "postprocess": (data) => ({etype: "op", op: "==", exprs: [data[0], data[2]]})},
    {"name": "equalityExpr", "symbols": ["equalityExpr", (lexer.has("BANGEQ") ? {type: "BANGEQ"} : BANGEQ), "relationalExpr"], "postprocess": (data) => ({etype: "op", op: "!=", exprs: [data[0], data[2]]})},
    {"name": "relationalExpr", "symbols": ["compareExpr"], "postprocess": id},
    {"name": "relationalExpr", "symbols": ["relationalExpr", (lexer.has("GEQ") ? {type: "GEQ"} : GEQ), "compareExpr"], "postprocess": (data) => ({etype: "op", op: ">=", exprs: [data[0], data[2]]})},
    {"name": "relationalExpr", "symbols": ["relationalExpr", (lexer.has("LEQ") ? {type: "LEQ"} : LEQ), "compareExpr"], "postprocess": (data) => ({etype: "op", op: "<=", exprs: [data[0], data[2]]})},
    {"name": "relationalExpr", "symbols": ["relationalExpr", (lexer.has("GT") ? {type: "GT"} : GT), "compareExpr"], "postprocess": (data) => ({etype: "op", op: ">", exprs: [data[0], data[2]]})},
    {"name": "relationalExpr", "symbols": ["relationalExpr", (lexer.has("LT") ? {type: "LT"} : LT), "compareExpr"], "postprocess": (data) => ({etype: "op", op: "<", exprs: [data[0], data[2]]})},
    {"name": "compareExpr", "symbols": ["addExpr"], "postprocess": id},
    {"name": "compareExpr", "symbols": ["compareExpr", (lexer.has("SPACESHIP") ? {type: "SPACESHIP"} : SPACESHIP), "addExpr"], "postprocess": (data) => ({etype: "op", op: "<=>", exprs: [data[0], data[2]]})},
    {"name": "addExpr", "symbols": ["mulExpr"], "postprocess": id},
    {"name": "addExpr", "symbols": ["addExpr", (lexer.has("PLUS") ? {type: "PLUS"} : PLUS), "mulExpr"], "postprocess": (data) => ({etype: "op", op: "+", exprs: [data[0], data[2]]})},
    {"name": "addExpr", "symbols": ["addExpr", (lexer.has("DASH") ? {type: "DASH"} : DASH), "mulExpr"], "postprocess": (data) => ({etype: "op", op: "-", exprs: [data[0], data[2]]})},
    {"name": "mulExpr", "symbols": ["unaryExpr"], "postprocess": id},
    {"name": "mulExpr", "symbols": ["mulExpr", (lexer.has("STAR") ? {type: "STAR"} : STAR), "pathExpr"], "postprocess": (data) => ({etype: "op", op: "*", exprs: [data[0], data[2]]})},
    {"name": "mulExpr", "symbols": ["mulExpr", (lexer.has("SLASH") ? {type: "SLASH"} : SLASH), "pathExpr"], "postprocess": (data) => ({etype: "op", op: "/", exprs: [data[0], data[2]]})},
    {"name": "mulExpr", "symbols": ["mulExpr", (lexer.has("PERCENT") ? {type: "PERCENT"} : PERCENT), "pathExpr"], "postprocess": (data) => ({etype: "op", op: "%", exprs: [data[0], data[2]]})},
    {"name": "unaryExpr", "symbols": ["pathExpr"], "postprocess": id},
    {"name": "unaryExpr", "symbols": [(lexer.has("BANG") ? {type: "BANG"} : BANG), "unaryExpr"], "postprocess": (data) => ({etype: "op", op: "!", exprs: [data[1]]})},
    {"name": "unaryExpr", "symbols": [(lexer.has("DASH") ? {type: "DASH"} : DASH), "unaryExpr"], "postprocess": (data) => ({etype: "op", op: "u-", exprs: [data[1]]})},
    {"name": "unaryExpr", "symbols": [(lexer.has("PLUS") ? {type: "PLUS"} : PLUS), "unaryExpr"], "postprocess": (data) => ({etype: "op", op: "u+", exprs: [data[1]]})},
    {"name": "pathExpr", "symbols": ["primaryExpr"], "postprocess": id},
    {"name": "primaryExpr", "symbols": ["literalVal"], "postprocess": id},
    {"name": "primaryExpr", "symbols": ["literalArray"], "postprocess": id},
    {"name": "primaryExpr", "symbols": ["literalMap"], "postprocess": id},
    {"name": "primaryExpr", "symbols": ["fnExpr"], "postprocess": id},
    {"name": "primaryExpr", "symbols": ["invokeExpr"], "postprocess": id},
    {"name": "primaryExpr", "symbols": ["lambdaExpr"], "postprocess": id},
    {"name": "primaryExpr", "symbols": ["refExpr"], "postprocess": id},
    {"name": "primaryExpr", "symbols": ["isNoAttrExpr"]},
    {"name": "primaryExpr", "symbols": [(lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullExpr", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess": (data) => data[1]},
    {"name": "primaryExpr", "symbols": ["pathExprNonTerm"], "postprocess": id},
    {"name": "fnExpr", "symbols": [(lexer.has("FN") ? {type: "FN"} : FN), "namedCallParams"], "postprocess":  (data) => {
            return {etype: "fn", fn: data[0].value, params: data[1]};
        } },
    {"name": "isNoAttrExpr", "symbols": [(lexer.has("KW_ISNOATTR") ? {type: "KW_ISNOATTR"} : KW_ISNOATTR), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullExpr", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess": (data) => ({etype: "isnoattr", exprs: [data[2]]})},
    {"name": "refExpr", "symbols": [(lexer.has("KW_REF") ? {type: "KW_REF"} : KW_REF), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullPathExpr", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess": (data) => ({etype: "ref", pathexpr: data[2]})},
    {"name": "refExpr", "symbols": [(lexer.has("KW_ISREF") ? {type: "KW_ISREF"} : KW_ISREF), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullExpr", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess": (data) => ({etype: "isref", exprs: [data[2]]})},
    {"name": "refExpr", "symbols": [(lexer.has("KW_REFINFO") ? {type: "KW_REFINFO"} : KW_REFINFO), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullExpr", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess": (data) => ({etype: "refinfo", exprs: [data[2]]})},
    {"name": "refExpr", "symbols": [(lexer.has("KW_RAW") ? {type: "KW_RAW"} : KW_RAW), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullPathExpr", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess": (data) => ({etype: "raw", exprs: [data[2]]})},
    {"name": "invokeExpr$ebnf$1$subexpression$1", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA), "innerNamedCallParams"]},
    {"name": "invokeExpr$ebnf$1", "symbols": ["invokeExpr$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "invokeExpr$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "invokeExpr", "symbols": [(lexer.has("KW_INVOKE") ? {type: "KW_INVOKE"} : KW_INVOKE), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullExpr", "invokeExpr$ebnf$1", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess":  (data) => {
            let rtn = {etype: "invoke", exprs: [data[2]], params: null};
            if (data[3] != null) {
                rtn.params = data[3][1];
            }
            return rtn;
        } },
    {"name": "lambdaExpr", "symbols": [(lexer.has("KW_LAMBDA") ? {type: "KW_LAMBDA"} : KW_LAMBDA), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullExpr", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess":  (data) => {
            return {etype: "lambda", exprs: [data[2]]};
        } },
    {"name": "literalArray", "symbols": [(lexer.has("LBRACK") ? {type: "LBRACK"} : LBRACK), "optionalLiteralArrayElements", (lexer.has("RBRACK") ? {type: "RBRACK"} : RBRACK)], "postprocess":  (data) => {
            return {etype: "array", exprs: data[1]};
        } },
    {"name": "literalArray", "symbols": [(lexer.has("LBRACK") ? {type: "LBRACK"} : LBRACK), "fullExpr", (lexer.has("DOTDOT") ? {type: "DOTDOT"} : DOTDOT), "fullExpr", (lexer.has("RBRACK") ? {type: "RBRACK"} : RBRACK)], "postprocess": (data) => ({etype: "array-range", exprs: [data[1], data[3]]})},
    {"name": "optionalLiteralArrayElements$ebnf$1", "symbols": ["literalArrayElements"], "postprocess": id},
    {"name": "optionalLiteralArrayElements$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "optionalLiteralArrayElements", "symbols": ["optionalLiteralArrayElements$ebnf$1"], "postprocess":  (data) => {
            if (data[0] == null) {
                return [];
            }
            return data[0];
        } },
    {"name": "literalArrayElementsNoComma$ebnf$1", "symbols": []},
    {"name": "literalArrayElementsNoComma$ebnf$1$subexpression$1", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA), "fullExpr"]},
    {"name": "literalArrayElementsNoComma$ebnf$1", "symbols": ["literalArrayElementsNoComma$ebnf$1", "literalArrayElementsNoComma$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "literalArrayElementsNoComma", "symbols": ["fullExpr", "literalArrayElementsNoComma$ebnf$1"], "postprocess":  (data) => {
            let rtn = [];
            rtn.push(data[0]);
            rtn.push(...data[1].map((v) => v[1]));
            return rtn;
        } },
    {"name": "literalArrayElements$ebnf$1", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA)], "postprocess": id},
    {"name": "literalArrayElements$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "literalArrayElements", "symbols": ["literalArrayElementsNoComma", "literalArrayElements$ebnf$1"], "postprocess":  (data) => {
            return data[0];
        } },
    {"name": "literalMap$ebnf$1", "symbols": ["literalMapElements"], "postprocess": id},
    {"name": "literalMap$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "literalMap", "symbols": [(lexer.has("LBRACE") ? {type: "LBRACE"} : LBRACE), "literalMap$ebnf$1", (lexer.has("RBRACE") ? {type: "RBRACE"} : RBRACE)], "postprocess": (data) => ({etype: "map", exprs: data[1]})},
    {"name": "literalMapElements$ebnf$1", "symbols": []},
    {"name": "literalMapElements$ebnf$1$subexpression$1", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA), "literalMapElement"]},
    {"name": "literalMapElements$ebnf$1", "symbols": ["literalMapElements$ebnf$1", "literalMapElements$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "literalMapElements$ebnf$2", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA)], "postprocess": id},
    {"name": "literalMapElements$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "literalMapElements", "symbols": ["literalMapElement", "literalMapElements$ebnf$1", "literalMapElements$ebnf$2"], "postprocess":  (data) => {
            let rtn = [];
            rtn.push(data[0]);
            rtn.push(...data[1].map((v) => v[1]));
            return rtn;
        } },
    {"name": "literalMapElement", "symbols": ["literalMapKey", (lexer.has("COLON") ? {type: "COLON"} : COLON), "fullExpr"], "postprocess": (data) => ({etype: "kv", key: data[0], valexpr: data[2]})},
    {"name": "literalMapKey", "symbols": ["idOrKeyword"], "postprocess": (data) => ({etype: "literal", val: data[0].value})},
    {"name": "literalMapKey", "symbols": ["stringLit"], "postprocess": (data) => ({etype: "literal", val: data[0]})},
    {"name": "literalVal", "symbols": ["stringLit"], "postprocess": (data) => ({etype: "literal", val: data[0]})},
    {"name": "literalVal", "symbols": [(lexer.has("JSNUM") ? {type: "JSNUM"} : JSNUM)], "postprocess": (data) => ({etype: "literal", val: data[0].value})},
    {"name": "literalVal", "symbols": [(lexer.has("KW_TRUE") ? {type: "KW_TRUE"} : KW_TRUE)], "postprocess": (data) => ({etype: "literal", val: true})},
    {"name": "literalVal", "symbols": [(lexer.has("KW_FALSE") ? {type: "KW_FALSE"} : KW_FALSE)], "postprocess": (data) => ({etype: "literal", val: false})},
    {"name": "literalVal", "symbols": [(lexer.has("KW_NULL") ? {type: "KW_NULL"} : KW_NULL)], "postprocess": (data) => ({etype: "literal", val: null})},
    {"name": "literalVal", "symbols": [(lexer.has("KW_NOATTR") ? {type: "KW_NOATTR"} : KW_NOATTR)], "postprocess": (data) => ({etype: "noattr"})},
    {"name": "pathExprNonTerm", "symbols": ["globalPathExpr"], "postprocess": id},
    {"name": "pathExprNonTerm", "symbols": ["contextPathExpr"], "postprocess": id},
    {"name": "pathExprNonTerm", "symbols": ["derefPathExpr"], "postprocess": id},
    {"name": "pathExprNonTerm", "symbols": ["caretPathExpr"], "postprocess": id},
    {"name": "derefPathExpr$ebnf$1", "symbols": []},
    {"name": "derefPathExpr$ebnf$1", "symbols": ["derefPathExpr$ebnf$1", "pathPartAny"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "derefPathExpr", "symbols": [(lexer.has("DOLLAR") ? {type: "DOLLAR"} : DOLLAR), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullExpr", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN), "derefPathExpr$ebnf$1"], "postprocess":  (data) => {
            let rtn = [];
            rtn.push({pathtype: "deref", expr: data[2]});
            rtn.push(...data[4]);
            return {etype: "path", path: rtn};
        } },
    {"name": "globalPathExpr$ebnf$1", "symbols": ["idOrKeyword"], "postprocess": id},
    {"name": "globalPathExpr$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "globalPathExpr$ebnf$2", "symbols": []},
    {"name": "globalPathExpr$ebnf$2", "symbols": ["globalPathExpr$ebnf$2", "pathPartAny"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "globalPathExpr", "symbols": [(lexer.has("DOLLAR") ? {type: "DOLLAR"} : DOLLAR), "globalPathExpr$ebnf$1", "globalPathExpr$ebnf$2"], "postprocess":  (data) => {
            let rtn = [];
            let gkey = "global";
            if (data[1] != null) {
                gkey = data[1].value;
            }
            rtn.push({pathtype: "root", pathkey: gkey});
            rtn.push(...data[2]);
            return {etype: "path", path: rtn};
        } },
    {"name": "caretPathExpr", "symbols": [(lexer.has("CARET") ? {type: "CARET"} : CARET), "contextPathExpr"], "postprocess": (data) => { data[1].path[0].caret = 1; return data[1]; }},
    {"name": "contextPathExpr$ebnf$1", "symbols": []},
    {"name": "contextPathExpr$ebnf$1", "symbols": ["contextPathExpr$ebnf$1", "pathPartAny"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "contextPathExpr", "symbols": [(lexer.has("ATID") ? {type: "ATID"} : ATID), "contextPathExpr$ebnf$1"], "postprocess":  (data) => {
            let rtn = [];
            rtn.push({pathtype: "root", pathkey: "context"});
            rtn.push({pathtype: "map", pathkey: data[0].value});
            rtn.push(...data[1]);
            return {etype: "path", path: rtn};
        } },
    {"name": "pathPartAny", "symbols": ["pathPartDot"], "postprocess": id},
    {"name": "pathPartAny", "symbols": ["pathPartDyn"], "postprocess": id},
    {"name": "pathPartBareMap", "symbols": ["idOrKeyword"], "postprocess": (data) => ({pathtype: "map", pathkey: data[0].value})},
    {"name": "pathPartDot", "symbols": [(lexer.has("DOT") ? {type: "DOT"} : DOT), "idOrKeyword"], "postprocess": (data) => ({pathtype: "map", pathkey: data[1].value})},
    {"name": "pathPartDot", "symbols": [(lexer.has("DOT") ? {type: "DOT"} : DOT), (lexer.has("ATID") ? {type: "ATID"} : ATID)], "postprocess": (data) => ({pathtype: "map", pathkey: "@" + data[1].value})},
    {"name": "pathPartDyn", "symbols": ["pathPartDynSimple"], "postprocess": id},
    {"name": "pathPartDynSimple", "symbols": [(lexer.has("LBRACK") ? {type: "LBRACK"} : LBRACK), "fullExpr", (lexer.has("RBRACK") ? {type: "RBRACK"} : RBRACK)], "postprocess":  (data) => {
            let expr = data[1];
            if (expr.etype == "literal") {
                if (typeof(expr.val) == "number") {
                    return {pathtype: "array", pathindex: expr.val};
                }
                return {pathtype: "map", pathkey: expr.val};
            }
            else {
                return {pathtype: "dyn", expr: data[1]};
            }
        } },
    {"name": "stringLit$subexpression$1", "symbols": [(lexer.has("STRSTART_DQ") ? {type: "STRSTART_DQ"} : STRSTART_DQ)]},
    {"name": "stringLit$subexpression$1", "symbols": [(lexer.has("STRSTART_SQ") ? {type: "STRSTART_SQ"} : STRSTART_SQ)]},
    {"name": "stringLit$ebnf$1", "symbols": []},
    {"name": "stringLit$ebnf$1", "symbols": ["stringLit$ebnf$1", "stringLitPart"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "stringLit", "symbols": ["stringLit$subexpression$1", "stringLit$ebnf$1", (lexer.has("STREND") ? {type: "STREND"} : STREND)], "postprocess": (data) => data[1].join("")},
    {"name": "stringLitPart", "symbols": [(lexer.has("STRPART") ? {type: "STRPART"} : STRPART)], "postprocess": (data) => data[0].value},
    {"name": "stringLitPart", "symbols": [(lexer.has("STRESC") ? {type: "STRESC"} : STRESC)], "postprocess": (data) => data[0].value},
    {"name": "idOrKeyword", "symbols": [(lexer.has("ID") ? {type: "ID"} : ID)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_TRUE") ? {type: "KW_TRUE"} : KW_TRUE)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_FALSE") ? {type: "KW_FALSE"} : KW_FALSE)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_NULL") ? {type: "KW_NULL"} : KW_NULL)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_NOATTR") ? {type: "KW_NOATTR"} : KW_NOATTR)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_FIRE") ? {type: "KW_FIRE"} : KW_FIRE)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_NOP") ? {type: "KW_NOP"} : KW_NOP)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_LOG") ? {type: "KW_LOG"} : KW_LOG)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_EXPR") ? {type: "KW_EXPR"} : KW_EXPR)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_LOCAL") ? {type: "KW_LOCAL"} : KW_LOCAL)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_IF") ? {type: "KW_IF"} : KW_IF)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_ELSE") ? {type: "KW_ELSE"} : KW_ELSE)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_THROW") ? {type: "KW_THROW"} : KW_THROW)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_RAW") ? {type: "KW_RAW"} : KW_RAW)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_REF") ? {type: "KW_REF"} : KW_REF)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_ISREF") ? {type: "KW_ISREF"} : KW_ISREF)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_REFINFO") ? {type: "KW_REFINFO"} : KW_REFINFO)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_SETRETURN") ? {type: "KW_SETRETURN"} : KW_SETRETURN)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_RETURN") ? {type: "KW_RETURN"} : KW_RETURN)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_INVALIDATE") ? {type: "KW_INVALIDATE"} : KW_INVALIDATE)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_CALLHANDLER") ? {type: "KW_CALLHANDLER"} : KW_CALLHANDLER)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_NAVTO") ? {type: "KW_NAVTO"} : KW_NAVTO)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_IN") ? {type: "KW_IN"} : KW_IN)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_INVOKE") ? {type: "KW_INVOKE"} : KW_INVOKE)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_LAMBDA") ? {type: "KW_LAMBDA"} : KW_LAMBDA)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_ISNOATTR") ? {type: "KW_ISNOATTR"} : KW_ISNOATTR)], "postprocess": id},
    {"name": "_$ebnf$1", "symbols": []},
    {"name": "_$ebnf$1", "symbols": ["_$ebnf$1", (lexer.has("WS") ? {type: "WS"} : WS)], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "_", "symbols": ["_$ebnf$1"]}
]
  , ParserStart: "ext_fullExpr"
}
if (typeof module !== 'undefined'&& typeof module.exports !== 'undefined') {
   module.exports = grammar;
} else {
   window.grammar = grammar;
}
})();
