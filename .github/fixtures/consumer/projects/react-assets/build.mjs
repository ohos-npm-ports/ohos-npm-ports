import assert from 'node:assert/strict';
import { cpSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const webpack = require('webpack');
const compiler = webpack({
  mode: 'production',
  entry: resolve('src/app.jsx'),
  output: { path: resolve('dist'), filename: 'app.js', clean: true },
  module: { rules: [{
    test: /\.jsx$/, exclude: /node_modules/,
    use: { loader: require.resolve('babel-loader'), options: { presets: [require.resolve('@babel/preset-react')] } },
  }] },
});
const stats = await new Promise((done, fail) => compiler.run((error, stats) => error ? fail(error) : done(stats)));
console.log(stats.toString({ colors: false }));
await new Promise((done, fail) => compiler.close((error) => error ? fail(error) : done()));
assert.equal(stats.hasErrors(), false, 'Frontend production bundle failed');
cpSync('public', 'dist', { recursive: true });
const assets = readdirSync('public').map((name) => {
  const url = '/' + encodeURIComponent(name);
  if (name.endsWith('.png')) return `<img src="${url}" alt="Generated frontend asset">`;
  if (name.endsWith('.css') && name !== 'style.css') return `<link rel="stylesheet" href="${url}">`;
  return '';
}).join('');
writeFileSync('dist/index.html', readFileSync('dist/index.html', 'utf8').replace('<!--PORT_ASSETS-->', assets));
