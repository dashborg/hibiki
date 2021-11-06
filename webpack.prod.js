const merge = require('webpack-merge');
const common = require('./webpack.common.js');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const wpfuncs = require("./webpack.funcs.js");

let merged = merge(common, {
    mode: "production",
    output: {
        path: __dirname,
        filename: "staticfiles/static/[name]-prod.js"
    },
});

merged.plugins = [
    new MiniCssExtractPlugin({filename: "staticfiles/static/[name].css", ignoreOrder: true}),
];

module.exports = merged;



