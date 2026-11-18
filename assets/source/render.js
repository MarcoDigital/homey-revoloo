'use strict';

/**
 * Renders the PNG app and driver images from the SVG sources in this folder.
 * Usage: node assets/source/render.js   (needs @resvg/resvg-js installed)
 */

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const here = __dirname;
const root = path.join(here, '..', '..');

const read = (name) => fs.readFileSync(path.join(here, name), 'utf8');

/** Inner content of a 500x500 source, without its white background. */
function inner(svg) {
  return svg
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<rect width="500" height="500" fill="#FFFFFF"\/>/, '');
}

const litterbox = read('litterbox.svg');
const cat = read('cat.svg');

const scene = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#E3EFEA"/>
      <stop offset="1" stop-color="#F6EFE6"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#E6D7C3"/>
      <stop offset="1" stop-color="#D9C6AD"/>
    </linearGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#BFE0F0"/>
      <stop offset="1" stop-color="#E8F5FA"/>
    </linearGradient>
  </defs>
  <rect width="1000" height="700" fill="url(#wall)"/>
  <!-- window -->
  <rect x="690" y="70" width="230" height="250" rx="16" fill="#FFFFFF"/>
  <rect x="706" y="86" width="198" height="218" rx="8" fill="url(#sky)"/>
  <rect x="800" y="86" width="10" height="218" fill="#FFFFFF"/>
  <rect x="706" y="190" width="198" height="10" fill="#FFFFFF"/>
  <ellipse cx="760" cy="140" rx="34" ry="14" fill="#FFFFFF" opacity="0.8"/>
  <!-- floor -->
  <rect x="0" y="540" width="1000" height="160" fill="url(#floor)"/>
  <rect x="0" y="536" width="1000" height="8" fill="#FFFFFF" opacity="0.7"/>
  <!-- plant -->
  <g>
    <path d="M70 380 C 40 300 60 250 90 230 C 100 290 95 340 84 384 Z" fill="#5E9C7E"/>
    <path d="M92 384 C 110 300 150 270 190 268 C 170 320 140 360 100 388 Z" fill="#4A8C7B"/>
    <path d="M80 386 C 40 340 10 330 -10 336 C 10 370 40 390 76 392 Z" fill="#6FAE8E"/>
    <path d="M44 384 L132 384 L122 560 L54 560 Z" fill="#D58B6A"/>
    <rect x="38" y="374" width="100" height="22" rx="6" fill="#C77B5A"/>
  </g>
  <!-- litter box -->
  <svg x="150" y="90" width="520" height="520" viewBox="0 0 500 500">${inner(litterbox)}</svg>
  <!-- cat -->
  <svg x="590" y="226" width="390" height="390" viewBox="0 0 500 500">${inner(cat)}</svg>
</svg>`;

fs.writeFileSync(path.join(here, 'app-image.svg'), scene);

function render(svg, width, out) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: 'white' }).render().asPng();
  const file = path.join(root, out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png);
  console.log(`${out} (${width}px)`);
}

render(scene, 250, 'assets/images/small.png');
render(scene, 500, 'assets/images/large.png');
render(scene, 1000, 'assets/images/xlarge.png');

for (const [name, svg] of [['litterbox', litterbox], ['cat', cat]]) {
  render(svg, 75, `drivers/${name}/assets/images/small.png`);
  render(svg, 500, `drivers/${name}/assets/images/large.png`);
  render(svg, 1000, `drivers/${name}/assets/images/xlarge.png`);
}
