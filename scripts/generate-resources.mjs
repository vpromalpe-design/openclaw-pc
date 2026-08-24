#!/usr/bin/env node
/**
 * TASK-401: Generate OpenClaw brand resource files (placeholder icons).
 * Brand color #FF4500 + white "OC" text. Replace with designer assets later.
 */

import sharp from 'sharp';
import toIco from 'to-ico';
import { Buffer } from 'node:buffer';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const RESOURCES_DIR = join(PROJECT_ROOT, 'resources');
const INSTALLER_DIR = join(RESOURCES_DIR, 'installer');
const APPLE_TOUCH_ICON_IN_RESOURCES = join(RESOURCES_DIR, 'apple-touch-icon.png');
const APPLE_TOUCH_ICON_IN_ROOT = join(PROJECT_ROOT, 'apple-touch-icon.png');

function resolveAppleTouchIconPath() {
  if (existsSync(APPLE_TOUCH_ICON_IN_RESOURCES)) return APPLE_TOUCH_ICON_IN_RESOURCES;
  if (existsSync(APPLE_TOUCH_ICON_IN_ROOT)) return APPLE_TOUCH_ICON_IN_ROOT;
  return null;
}

const BRAND = '#FF4500';
const WHITE = '#FFFFFF';
// Liquid Glass dark installer sidebar (Task: dark installer).
const SIDEBAR_BG = '#0B1020';
const SIDEBAR_ACCENT = '#5AC8FA'; // light blue — matches iOS blue accent family

function iconSvg(size) {
  const r = Math.max(2, Math.round(size / 6));
  const m = Math.max(1, Math.round(size / 16));
  const fs = Math.max(8, Math.round(size * 0.42));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect x="${m}" y="${m}" width="${size - m * 2}" height="${size - m * 2}" rx="${r}" ry="${r}" fill="${BRAND}"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
        font-family="Segoe UI,Arial,sans-serif" font-weight="bold" font-size="${fs}" fill="${WHITE}">OC</text>
</svg>`;
}

function traySvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
  <circle cx="16" cy="16" r="15" fill="${BRAND}"/>
  <text x="16" y="17" text-anchor="middle" dominant-baseline="middle"
        font-family="Segoe UI,Arial,sans-serif" font-weight="bold" font-size="12" fill="${WHITE}">OC</text>
</svg>`;
}

// Recolor the apple-touch-icon logo to a solid color (alpha preserved) and
// return it as a data-URI PNG for embedding in SVG.
async function recolorLogoTo(dataUri, targetRgb) {
  const png = Buffer.from(dataUri.split(',')[1], 'base64');
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  for (let i = 0; i < info.width * info.height; i++) {
    const o = i * 4;
    if (out[o + 3] > 0) {
      out[o] = targetRgb[0];
      out[o + 1] = targetRgb[1];
      out[o + 2] = targetRgb[2];
    }
  }
  const recolored = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
  return `data:image/png;base64,${recolored.toString('base64')}`;
}

// Dark 164x314 wizard sidebar: #0B1020 background, recolored light-blue logo
// ring, "OpenClaw PC" in light blue.
async function sidebarSvg() {
  const logoPath = resolveAppleTouchIconPath();
  let logoHref = '';
  if (logoPath) {
    const { readFile } = await import('node:fs/promises');
    const logoPng = await readFile(logoPath);
    logoHref = await recolorLogoTo(`data:image/png;base64,${logoPng.toString('base64')}`, [0x5a, 0xc8, 0xfa]);
  }
  const logoBlock = logoHref
    ? `<image x="34" y="48" width="96" height="96" href="${logoHref}"/>`
    : `<text x="82" y="100" text-anchor="middle" dominant-baseline="middle"
          font-family="Segoe UI,Arial,sans-serif" font-weight="bold" font-size="28" fill="${SIDEBAR_ACCENT}">OC</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314">
  <rect width="164" height="314" fill="${SIDEBAR_BG}"/>
  ${logoBlock}
  <text x="82" y="196" text-anchor="middle" dominant-baseline="middle"
        font-family="Segoe UI,Arial,sans-serif" font-weight="bold" font-size="24" fill="${SIDEBAR_ACCENT}">OpenClaw PC</text>
  <text x="82" y="222" text-anchor="middle" dominant-baseline="middle"
        font-family="Segoe UI,Arial,sans-serif" font-size="12" fill="rgba(255,255,255,0.65)">Windows Desktop</text>
</svg>`;
}

async function generateIconIco() {
  const sizes = [16, 32, 48, 256];
  const outPath = join(RESOURCES_DIR, 'icon.ico');
  const appleTouchIconPath = resolveAppleTouchIconPath();
  let pngBuffers;
  if (appleTouchIconPath) {
    if (process.env.REGENERATE_ICON === '0') {
      if (existsSync(outPath)) {
        console.log('  ✓ icon.ico (keep existing file)');
        return outPath;
      }
      console.warn('  ! icon.ico missing, REGENERATE_ICON=0 ignored');
    }
    pngBuffers = await Promise.all(
      sizes.map(s => sharp(appleTouchIconPath).resize(s, s).png().toBuffer())
    );
    console.log('  ✓ icon.ico (from resources/apple-touch-icon.png)');
  } else {
    if (existsSync(outPath) && process.env.REGENERATE_ICON !== '1') {
      console.log('  ✓ icon.ico (keep existing file)');
      return outPath;
    }
    pngBuffers = await Promise.all(
      sizes.map(s =>
        sharp(Buffer.from(iconSvg(s)))
          .resize(s, s)
          .png()
          .toBuffer()
      )
    );
    console.log(`  ✓ icon.ico (${sizes.map(s => `${s}x${s}`).join(', ')})`);
  }
  const icoBuffer = await toIco(pngBuffers, { resize: false });
  await writeFile(outPath, icoBuffer);
  return outPath;
}

async function generateTrayIcon() {
  const outPath = join(RESOURCES_DIR, 'tray-icon.png');
  const appleTouchIconPath = resolveAppleTouchIconPath();
  if (appleTouchIconPath) {
    await sharp(appleTouchIconPath).resize(32, 32).png().toFile(outPath);
    console.log('  ✓ tray-icon.png (32x32, from resources/apple-touch-icon.png)');
  } else {
    await sharp(Buffer.from(traySvg()))
      .resize(32, 32)
      .png()
      .toFile(outPath);
    console.log('  ✓ tray-icon.png (32x32, transparent bg)');
  }
  return outPath;
}

function rawToBmp(rawPixels, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const headerSize = 14 + 40;
  const fileSize = headerSize + pixelDataSize;

  const buf = Buffer.alloc(fileSize);
  buf.write('BM', 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(headerSize, 10);

  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelDataSize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);

  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 3;
    const dstRow = headerSize + y * rowSize;
    for (let x = 0; x < width; x++) {
      const si = srcRow + x * 3;
      const di = dstRow + x * 3;
      buf[di] = rawPixels[si + 2];     // B
      buf[di + 1] = rawPixels[si + 1]; // G
      buf[di + 2] = rawPixels[si];     // R
    }
  }
  return buf;
}

async function generateInstallerSidebar() {
  const width = 164, height = 314;
  const { data, info } = await sharp(Buffer.from(await sidebarSvg()))
    .resize(width, height)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bmpBuf = rawToBmp(data, info.width, info.height);
  const outPath = join(INSTALLER_DIR, 'installer-sidebar.bmp');
  await writeFile(outPath, bmpBuf);
  console.log('  ✓ installer-sidebar.bmp (164x314)');
  return outPath;
}

function verify() {
  console.log('\nVerification:');
  const licenseFiles = readdirSync(RESOURCES_DIR)
    .filter((f) => /^license_[a-z_]+\\.txt$/i.test(f))
    .sort();
  const checks = [
    { name: 'icon.ico', path: join(RESOURCES_DIR, 'icon.ico') },
    { name: 'tray-icon.png', path: join(RESOURCES_DIR, 'tray-icon.png') },
    { name: 'installer-sidebar.bmp', path: join(INSTALLER_DIR, 'installer-sidebar.bmp') },
    ...(licenseFiles.length > 0
      ? licenseFiles.map((f) => ({ name: f, path: join(RESOURCES_DIR, f) }))
      : [{ name: 'license_*.txt (multilingual licenses)', path: join(RESOURCES_DIR, 'license_en.txt') }]),
  ];
  let ok = true;
  for (const { name, path } of checks) {
    if (!existsSync(path)) {
      console.log(`  ✗ ${name}: missing`);
      ok = false;
      continue;
    }
    const size = statSync(path).size;
    if (size === 0) {
      console.log(`  ✗ ${name}: empty file`);
      ok = false;
      continue;
    }
    console.log(`  ✓ ${name}: OK (${size} bytes)`);
  }
  return ok;
}

async function main() {
  await mkdir(RESOURCES_DIR, { recursive: true });
  await mkdir(INSTALLER_DIR, { recursive: true });

  console.log('Generating OpenClaw brand assets...\n');
  await generateIconIco();
  await generateTrayIcon();
  await generateInstallerSidebar();

  console.log('\nImage assets done.');

  const ok = verify();
  process.exit(ok ? 0 : 1);
}

main().catch(err => {
  console.error('Generation failed:', err);
  process.exit(1);
});
