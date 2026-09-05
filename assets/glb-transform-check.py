#!/usr/bin/env python3
"""
glb-transform-check.py — verify a GLB's transform convention, and optionally
diff it against a reference GLB.

    python3 glb-transform-check.py new-model.glb
    python3 glb-transform-check.py new-model.glb --ref villa-mesh.glb
    python3 glb-transform-check.py new-model.glb --scalar 5.71853

Checks the three things that actually matter for a Three.js asset:
  1. node transform is identity (nothing baked in that setScalar would compound)
  2. geometry is origin-centred (so position.y = -min.y*scalar grounds it)
  3. bounding box, reported in BOTH glTF (Y-up) and Blender (Z-up) axis order

No dependencies beyond numpy. Works on Draco-compressed files: the POSITION
accessor min/max is mandatory in glTF, so the bbox is read without decoding.
"""

import argparse
import json
import struct
import sys

import numpy as np

IDENTITY_TOL = 1e-6      # how close node TRS must be to identity
CENTRE_TOL   = 1e-3      # how close bbox centre must be to origin, in raw units


def load(path):
    b = open(path, 'rb').read()
    magic, _ver, total = struct.unpack('<III', b[:12])
    if magic != 0x46546C67:
        sys.exit(f"{path}: not a GLB (bad magic)")
    off, js, bins = 12, None, None
    while off < total:
        clen, ctype = struct.unpack('<II', b[off:off + 8])
        data = b[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(data.decode('utf-8'))
        elif ctype == 0x004E4942:
            bins = data
        off += 8 + clen + ((4 - clen % 4) % 4 if clen % 4 else 0)
    return js, bins, len(b)


def node_transform(node):
    """Return (translation, quaternion, scale, has_matrix_key)."""
    if 'matrix' in node:
        M = np.array(node['matrix'], dtype=np.float64).reshape(4, 4).T
        t = M[:3, 3]
        s = np.linalg.norm(M[:3, :3], axis=0)
        return t, None, s, True
    return (np.array(node.get('translation', [0, 0, 0]), dtype=np.float64),
            np.array(node.get('rotation', [0, 0, 0, 1]), dtype=np.float64),
            np.array(node.get('scale', [1, 1, 1]), dtype=np.float64),
            False)


def mesh_nodes(js):
    """Every node carrying a mesh, with its accumulated world matrix."""
    out = []

    def trs_matrix(node):
        if 'matrix' in node:
            return np.array(node['matrix'], dtype=np.float64).reshape(4, 4).T
        M = np.eye(4)
        t = node.get('translation', [0, 0, 0])
        x, y, z, w = node.get('rotation', [0, 0, 0, 1])
        s = node.get('scale', [1, 1, 1])
        R = np.array([
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w),     2 * (x * z + y * w)],
            [2 * (x * y + z * w),     1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w),     2 * (y * z + x * w),     1 - 2 * (x * x + y * y)],
        ])
        M[:3, :3] = R @ np.diag(s)
        M[:3, 3] = t
        return M

    def walk(i, parent):
        n = js['nodes'][i]
        W = parent @ trs_matrix(n)
        if 'mesh' in n:
            out.append((i, n, W))
        for c in n.get('children', []):
            walk(c, W)

    scene = js['scenes'][js.get('scene', 0)]
    for root in scene['nodes']:
        walk(root, np.eye(4))
    return out


def world_bbox(js):
    """Union of every mesh primitive's POSITION min/max, transformed to world."""
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)
    found = False
    for _i, node, W in mesh_nodes(js):
        for prim in js['meshes'][node['mesh']]['primitives']:
            acc = js['accessors'][prim['attributes']['POSITION']]
            if 'min' not in acc or 'max' not in acc:
                continue
            mn = np.array(acc['min'], dtype=np.float64)
            mx = np.array(acc['max'], dtype=np.float64)
            # transform all 8 corners, not just min/max
            corners = np.array([[x, y, z]
                                for x in (mn[0], mx[0])
                                for y in (mn[1], mx[1])
                                for z in (mn[2], mx[2])])
            wc = (W[:3, :3] @ corners.T).T + W[:3, 3]
            lo = np.minimum(lo, wc.min(0))
            hi = np.maximum(hi, wc.max(0))
            found = True
    if not found:
        sys.exit("no POSITION accessor with min/max — cannot measure bbox")
    return lo, hi


def report(path, scalar=None):
    js, _bins, size = load(path)
    print(f"\n{'=' * 68}\n{path}\n{'=' * 68}")
    print(f"  file        {size / 1048576:.2f} MB")
    print(f"  generator   {js.get('asset', {}).get('generator', '?')}")
    req = js.get('extensionsRequired')
    if req:
        print(f"  requires    {req}")

    meshes = mesh_nodes(js)
    print(f"  mesh nodes  {len(meshes)}")

    ok = True

    # --- 1. node transform ------------------------------------------------
    print("\n  [1] NODE TRANSFORM")
    for i, node, _W in meshes:
        t, q, s, has_matrix = node_transform(node)
        name = node.get('name', '(unnamed)')
        t_ok = np.allclose(t, 0, atol=IDENTITY_TOL)
        s_ok = np.allclose(s, 1, atol=IDENTITY_TOL)
        q_ok = q is None or np.allclose(q, [0, 0, 0, 1], atol=IDENTITY_TOL)
        good = t_ok and s_ok and q_ok and not has_matrix
        ok &= good
        print(f"      node[{i}] {name}")
        print(f"        translation {np.round(t, 7).tolist()}   {'ok' if t_ok else 'NOT ZERO'}")
        if q is not None:
            print(f"        rotation    {np.round(q, 7).tolist()}   {'ok' if q_ok else 'NOT IDENTITY'}")
        print(f"        scale       {np.round(s, 7).tolist()}   {'ok' if s_ok else 'NOT UNIT — apply scale in Blender'}")
        if has_matrix:
            print("        matrix key present — exporter baked a transform")
        print(f"        => {'IDENTITY' if good else 'NOT IDENTITY'}")

    # --- 2. origin centring ----------------------------------------------
    lo, hi = world_bbox(js)
    size_raw = hi - lo
    centre = (hi + lo) / 2
    centred = np.allclose(centre, 0, atol=CENTRE_TOL)
    ok &= centred
    print("\n  [2] ORIGIN CENTRING")
    print(f"      bbox centre {np.round(centre, 7).tolist()}")
    print(f"      => {'CENTRED' if centred else 'OFF-CENTRE — Set Origin to Geometry (Bounds Center)'}")

    # --- 3. bounding box --------------------------------------------------
    print("\n  [3] BOUNDING BOX")
    print(f"      min                {np.round(lo, 7).tolist()}")
    print(f"      max                {np.round(hi, 7).tolist()}")
    print(f"      glTF   (Y-up)  X {size_raw[0]:.8f}  Y {size_raw[1]:.8f}  Z {size_raw[2]:.8f}")
    print(f"      Blender(Z-up)  X {size_raw[0]:.8f}  Y {size_raw[2]:.8f}  Z {size_raw[1]:.8f}"
          "     <- what the N-panel shows")
    if scalar:
        m = size_raw * scalar
        print(f"      at scalar {scalar}:  X {m[0]:.4f} m   Y {m[1]:.4f} m   Z {m[2]:.4f} m")
        print(f"      ground offset: position.y = {-lo[1] * scalar:+.4f}")

    print(f"\n  VERDICT: {'PASS' if ok else 'FAIL'}")
    return {'size': size_raw, 'centre': centre, 'min': lo, 'max': hi, 'ok': ok}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('glb')
    ap.add_argument('--ref', help='reference GLB to diff against')
    ap.add_argument('--scalar', type=float, help='multiplier used in code, e.g. 5.71853')
    a = ap.parse_args()

    new = report(a.glb, a.scalar)
    if not a.ref:
        return

    ref = report(a.ref, a.scalar)
    print(f"\n{'=' * 68}\nDIFF  {a.glb}  vs  {a.ref}\n{'=' * 68}")
    print(f"  {'axis':6s} {'new':>14s} {'ref':>14s} {'delta':>12s} {'%':>9s}")
    for i, ax in enumerate('XYZ'):
        n, r = new['size'][i], ref['size'][i]
        pct = 100 * abs(n - r) / r if r else float('nan')
        print(f"  {ax:6s} {n:14.8f} {r:14.8f} {n - r:+12.8f} {pct:8.3f}%")
    print(f"\n  aspect X:Z   new {new['size'][0] / new['size'][2]:.5f}"
          f"   ref {ref['size'][0] / ref['size'][2]:.5f}")
    print("\n  Note: identical DIMENSIONS are only required if the two models are")
    print("  the same building. What must always match is the CONVENTION —")
    print("  identity node, origin-centred, +Y up. Give each asset its own")
    print("  scalar sized so bbox x scalar lands on the metres you intend.")


if __name__ == '__main__':
    main()
