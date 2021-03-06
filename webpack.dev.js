const webpack = require('webpack');
const merge = require('webpack-merge');
const common = require('./webpack.common.js');
const path = require('path');
const CopyPlugin = require("copy-webpack-plugin");
const VERSION = "v0.3.4";

var merged = merge.merge(common, {
    mode: "development",
    devtool: "source-map",
    devServer: {
        static: {
            directory: path.join(__dirname, "static"),
        },
        port: 9000,
        headers: {
            'Cache-Control': 'no-store',
        },
    },
    watchOptions: {
        aggregateTimeout: 200,
    },
});

var definePlugin = new webpack.DefinePlugin({
    __HIBIKIVERSION__: JSON.stringify(VERSION),
    __HIBIKIBUILD__: JSON.stringify("devbuild"),
});
merged.plugins.push(definePlugin);

module.exports = merged;

