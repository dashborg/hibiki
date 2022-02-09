const webpack = require('webpack');
const merge = require('webpack-merge');
const common = require('./webpack.common.js');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const LodashModuleReplacementPlugin = require('lodash-webpack-plugin');
const TerserPlugin = require("terser-webpack-plugin");
const moment = require("dayjs");
const fs = require("fs");
const VERSION = "v0.3.0";

function makeBuildStr() {
    let buildStr = moment().format("YYYYMMDD-HHmmss");
    console.log("Hibiki " + VERSION + " build " + buildStr);
    return buildStr;
}

const BUILD = makeBuildStr();

let BundleAnalyzerPlugin = null;
if (process.env.WEBPACK_ANALYZE) {
    BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
}

let merged = merge.merge(common, {
    mode: "production",
    output: {
        path: __dirname,
        filename: "build/hibiki/latest/[name]-prod.min.js"
    },
    devtool: "source-map",
    optimization: {
        minimize: true,
    },
});

merged.externals = {};
merged.plugins.push(new LodashModuleReplacementPlugin());
merged.plugins.push(new MiniCssExtractPlugin({filename: "dist/[name].css", ignoreOrder: true}));
if (BundleAnalyzerPlugin != null) {
    merged.plugins.push(new BundleAnalyzerPlugin());
}
merged.plugins.push(new webpack.DefinePlugin({
    __HIBIKIVERSION__: JSON.stringify(VERSION),
    __HIBIKIBUILD__: JSON.stringify(BUILD),
}));

module.exports = merged;



