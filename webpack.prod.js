const merge = require('webpack-merge');
const common = require('./webpack.common.js');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const LodashModuleReplacementPlugin = require('lodash-webpack-plugin');
// const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

let merged = merge.merge(common, {
    mode: "production",
    output: {
        path: __dirname,
        filename: "dist/[name]-prod.js"
    },
});

merged.externals = {};

merged.plugins = [
    new LodashModuleReplacementPlugin(),
    new MiniCssExtractPlugin({filename: "dist/[name].css", ignoreOrder: true}),
    // new BundleAnalyzerPlugin(),
];

module.exports = merged;



