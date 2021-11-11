const merge = require('webpack-merge');
const common = require('./webpack.common.js');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
// const wpfuncs = require("./webpack.funcs.js");

let merged = merge.merge(common, {
    mode: "production",
    output: {
        path: __dirname,
        filename: "dist/[name]-prod.js"
    },
});
merged.externals = {};

merged.plugins = [
    new MiniCssExtractPlugin({filename: "dist/[name].css", ignoreOrder: true}),
];

module.exports = merged;



