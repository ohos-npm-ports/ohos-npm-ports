// @test-setup: true
// @test-timeout: 1800
import assert from 'node:assert/strict';

export function setup({ run }) {
  if (process.platform !== 'openharmony') return;
  run('brew', ['install', '-y',
    'jpeg-turbo', 'libpng', 'webp', 'libtiff', 'giflib', 'glib', 'little-cms2',
    'highway', 'cgif', 'exiv2', 'libarchive', 'libheif', 'libde265', 'libspng',
    'librsvg', 'cairo', 'pango', 'freetype', 'fontconfig', 'libimagequant',
    'openjpeg', 'aom', 'dav1d', 'orc', 'gettext',
  ]);
}

export default async function test({ requirePackage }) {
  const sharp = requirePackage('sharp');
  const png = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 5, g: 200, b: 40 } },
  }).png().toBuffer();
  if (process.platform === 'openharmony') {
    const jp2 = await sharp(png).jp2().toBuffer();
    const decoded = await sharp(jp2).raw().toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.width, 40);
    assert.equal(decoded.info.height, 30);
    assert.ok(sharp.format.jp2?.output);
  }
  const avif = await sharp(png).avif().toBuffer();
  assert.ok(avif.length > 0);
  return { result: { jp2RoundTrip: process.platform === 'openharmony' ? true : 'not-covered', avifEncode: true }, assets: [] };
}
