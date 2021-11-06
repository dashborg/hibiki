const merge = require('webpack-merge');
const common = require('./webpack.common.js');
const path = require('path');
const CopyPlugin = require("copy-webpack-plugin");

module.exports = merge.merge(common, {
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

