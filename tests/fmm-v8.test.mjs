// Magnet artwork helpers (family-memory-magnets/admin/magnet.js): the 300 DPI tag must be a valid PNG chunk.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../family-memory-magnets/admin/magnet.js';
const M = globalThis.FMMMagnet;

test('crc32 matches the PNG standard check value', () => {
  assert.equal(M.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('withDpi inserts a valid pHYs chunk (300 DPI) right after IHDR and keeps the rest intact', () => {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = new Uint8Array(25); ihdr.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 0);
  const tail = new Uint8Array([9, 9, 9]);
  const png = new Uint8Array([...sig, ...ihdr, ...tail]);
  const out = M.withDpi(png, 300);
  assert.equal(out.length, png.length + 21);
  const dv = new DataView(out.buffer);
  assert.equal(dv.getUint32(33), 9);
  assert.equal(String.fromCharCode(...out.slice(37, 41)), 'pHYs');
  assert.equal(dv.getUint32(41), 11811); assert.equal(dv.getUint32(45), 11811); // 300 DPI in pixels per metre
  assert.equal(out[49], 1); // unit = metre
  assert.equal(dv.getUint32(50), M.crc32(out.subarray(37, 50)));
  assert.deepEqual([...out.slice(-3)], [9, 9, 9]);
  assert.equal(M.SIZE, 1500); assert.equal(M.DPI, 300); // 5 in x 300 DPI
});
