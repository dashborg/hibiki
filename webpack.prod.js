const merge = require('webpack-merge');
const common = require('./webpack.common.js');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const LodashModuleReplacementPlugin = require('lodash-webpack-plugin');
const TerserPlugin = require("terser-webpack-plugin");
let BundleAnalyzerPlugin = null;
if (process.env.WEBPACK_ANALYZE) {
    BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
}

let merged = merge.merge(common, {
    mode: "production",
    output: {
        path: __dirname,
        filename: "dist/[name]-prod.min.js"
    },
    devtool: "source-map",
    optimization: {
        minimize: true,
    },
});

merged.externals = {};

merged.plugins = [
    new LodashModuleReplacementPlugin(),
    new MiniCssExtractPlugin({filename: "dist/[name].css", ignoreOrder: true}),
];
if (BundleAnalyzerPlugin != null) {
    merged.plugins.push(new BundleAnalyzerPlugin());
}

module.exports = merged;



