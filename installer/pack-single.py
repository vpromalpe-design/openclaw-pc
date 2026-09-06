#!/usr/bin/env python3
"""
pack-single.py — собирает ЕДИНЫЙ exe дистрибутива OpenClaw PC.

Формат: [wrapper.exe][core.exe (NSIS payload)][footer]
footer = magic(16 bytes: OCPC-SFX-PAYLOAD) + payload_len(Int64 LE)  -> 24 bytes
Обёртка (.NET single-file) при запуске читает свой хвост, извлекает payload
во временную папку и запускает NSIS тихо (/S). Рядом с exe ничего не нужно.

Usage:
  python3 pack-single.py <wrapper.exe> <core.exe> <out.exe>
  python3 pack-single.py --check <out.exe>     # проверка футера
"""
import os
import struct
import sys

MAGIC = b"OCPC-SFX-PAYLOAD"
FOOTER = len(MAGIC) + 8


def pack(wrapper: str, core: str, out: str) -> None:
    core_len = os.path.getsize(core)
    if core_len <= 0:
        sys.exit("core is empty")
    with open(out, "wb") as o:
        for path in (wrapper, core):
            with open(path, "rb") as f:
                while True:
                    buf = f.read(1 << 20)
                    if not buf:
                        break
                    o.write(buf)
        o.write(MAGIC)
        o.write(struct.pack("<q", core_len))
    total = os.path.getsize(out)
    print(f"OK: {out}")
    print(f"  wrapper={os.path.getsize(wrapper)} core={core_len} total={total} footer={FOOTER}")


def check(path: str) -> int:
    with open(path, "rb") as f:
        f.seek(-FOOTER, os.SEEK_END)
        footer = f.read(FOOTER)
    if footer[: len(MAGIC)] != MAGIC:
        print("BAD: no payload footer")
        return 1
    (core_len,) = struct.unpack("<q", footer[len(MAGIC):])
    core_start = os.path.getsize(path) - FOOTER - core_len
    print(f"OK: footer present, core payload len={core_len} start={core_start}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--check":
        sys.exit(check(sys.argv[2]))
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    pack(*sys.argv[1:4])
