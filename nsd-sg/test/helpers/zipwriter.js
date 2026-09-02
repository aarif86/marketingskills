// Minimal ZIP writer for tests. Lets us craft hostile archives (traversal names, symlinks,
// lying size headers) that no normal tool would produce.
import zlib from 'node:zlib';

function crc32(buf) {
  let c;
  const table = crc32.table ??= (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

/**
 * @param {Array<{name:string, data?:Buffer|string, symlink?:boolean, lieUncompressed?:number, store?:boolean}>} entries
 */
export function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? '', 'utf8');
    const name = Buffer.from(e.name, 'utf8');
    const method = e.store ? 0 : 8;
    const comp = e.store ? data : zlib.deflateRawSync(data);
    const crc = crc32(data);
    const uncompressed = e.lieUncompressed ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // utf8 flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); // time/date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(uncompressed, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
    const mode = e.symlink ? 0o120777 : 0o100644;
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}
