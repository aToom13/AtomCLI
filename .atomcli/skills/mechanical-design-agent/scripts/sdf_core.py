"""
sdf_core.py
===========
Signed-distance-field (SDF) primitives and combinators, meshed via
`skimage.measure.marching_cubes`. This is the right tool for organic,
"grown", or blended shapes -- anything better described by "how close is
this point to the surface" than by a sketch-and-extrude/boolean tree:
trees, droplets, fillets that must melt into their neighbour, creature
forms, any part whose defining feature is a smooth blend radius rather
than a toleranced dimension.

Division of labour with csg_core.py:
    - csg_core  -> hard-edged, mechanical, bolted/machined parts (exact)
    - sdf_core  -> organic, blended, "grown" shapes (approximate at the
                   voxel scale -- see method_selection.md for the tradeoff)

Every SDF here is a plain Python function `f(points) -> distances`, taking
an (N,3) numpy array and returning an (N,) array of signed distances
(negative = inside, positive = outside, 0 = surface). This is the
"currency" of the module -- primitives, combinators, and `sdf_to_mesh` all
speak this one calling convention, so you can freely nest
`op_smooth_union(sd_sphere(...), op_union(sd_cylinder(...), ...))` etc.
before ever touching a grid.

`sdf_to_mesh` is the only function that actually samples a grid and pays
the O(resolution^-3) cost -- keep every SDF-authoring step above it cheap
(closed-form distance functions), and only call `sdf_to_mesh` once you're
ready to pay for a concrete mesh (or a handful of times while iterating on
`bounds`/`resolution`).

Output is a `trimesh.Trimesh`, the same currency `csg_core.py` and
`mesh_utils.py` use, so an SDF-built part can be handed straight to
`mesh_utils.check_watertight` and then into a `kinematics.Link`, or bridged
into `csg_core` via `csg_core.from_trimesh` for a further exact boolean
pass (see method_selection.md's "does a single part need both" case).
"""
from __future__ import annotations
import numpy as np
import trimesh
from skimage import measure


class SDFError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Primitives -- each returns a callable f(points: (N,3)) -> (N,) distances
# ---------------------------------------------------------------------------

def sd_sphere(center=(0.0, 0.0, 0.0), radius=1.0):
    c = np.asarray(center, dtype=float)

    def f(p):
        return np.linalg.norm(p - c, axis=-1) - radius
    return f


def sd_box(center=(0.0, 0.0, 0.0), half_extents=(1.0, 1.0, 1.0)):
    """Axis-aligned box. Rarely the final word for a mechanical face (use
    csg_core.box for that -- it's exact), but useful as a cheap bounding
    volume to intersect/union with organic features, or for a soft/rounded
    crate-like shape when combined with op_round."""
    c = np.asarray(center, dtype=float)
    h = np.asarray(half_extents, dtype=float)

    def f(p):
        q = np.abs(p - c) - h
        outside = np.linalg.norm(np.maximum(q, 0.0), axis=-1)
        inside = np.minimum(np.max(q, axis=-1), 0.0)
        return outside + inside
    return f


def sd_cylinder(a, b, radius):
    """Capped cylinder from point `a` to point `b` with the given radius --
    the workhorse for trunks, limbs, and generic organic rods."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    ba = b - a
    l = np.linalg.norm(ba)
    if l < 1e-12:
        raise SDFError("sd_cylinder: a and b coincide, axis is undefined")
    ba_hat = ba / l

    def f(p):
        pa = p - a
        y = np.einsum("ij,j->i", pa, ba_hat)
        x = np.linalg.norm(pa - y[:, None] * ba_hat, axis=-1)
        dx = x - radius
        dy = np.abs(y - l / 2) - l / 2
        outside = np.sqrt(np.clip(np.maximum(dx, 0), 0, None) ** 2
                           + np.clip(np.maximum(dy, 0), 0, None) ** 2)
        inside = np.minimum(np.maximum(dx, dy), 0.0)
        return outside + inside
    return f


def sd_capsule(a, b, radius):
    """Like sd_cylinder but with hemispherical (not flat) caps -- the
    natural choice for a "pill"-shaped organic limb/branch segment where
    a flat end-cap would look like a machined part."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    ba = b - a
    l2 = np.dot(ba, ba)
    if l2 < 1e-24:
        return sd_sphere(a, radius)

    def f(p):
        pa = p - a
        h = np.clip(np.einsum("ij,j->i", pa, ba) / l2, 0.0, 1.0)
        proj = a + h[:, None] * ba
        return np.linalg.norm(p - proj, axis=-1) - radius
    return f


def sd_round_cone(a, b, radius_a, radius_b):
    """Cone/frustum between `a` and `b` with independently-tapering radii
    and rounded (not flat) ends -- this is what makes a stack of these look
    like a naturally tapering branch or a foliage tier rather than a lathe
    part; see method_selection.md's pine-tree example."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    ba = b - a
    l2 = np.dot(ba, ba)
    if l2 < 1e-24:
        raise SDFError("sd_round_cone: a and b coincide, axis is undefined")

    def f(p):
        pa = p - a
        y = np.einsum("ij,j->i", pa, ba) / l2
        y2 = np.clip(y, 0.0, 1.0)
        proj = a + y2[:, None] * ba
        r_line = radius_a + y2 * (radius_b - radius_a)
        d_line = np.linalg.norm(p - proj, axis=-1) - r_line
        d_a = np.linalg.norm(p - a, axis=-1) - radius_a
        d_b = np.linalg.norm(p - b, axis=-1) - radius_b
        return np.where((y > 0) & (y < 1), d_line, np.minimum(d_a, d_b))
    return f


# ---------------------------------------------------------------------------
# Boolean-style combinators (sharp) and blends (smooth)
# ---------------------------------------------------------------------------

def op_union(*sdfs):
    def f(p):
        return np.minimum.reduce([s(p) for s in sdfs])
    return f


def op_subtract(sdf_a, sdf_b):
    """a with b's volume removed (sharp edge at the boundary)."""
    def f(p):
        return np.maximum(sdf_a(p), -sdf_b(p))
    return f


def op_intersect(sdf_a, sdf_b):
    def f(p):
        return np.maximum(sdf_a(p), sdf_b(p))
    return f


def op_smooth_union(sdf_a, sdf_b, k=0.2):
    """Polynomial-smooth union -- `k` IS the design parameter for "how much
    do these two features merge" (method_selection.md). k=0 degenerates to
    a sharp op_union; larger k blends over a wider neck. This is the
    primary tool for a splitting-droplet neck or foliage tiers that must
    visually flow into one another rather than sit as distinct volumes."""
    def f(p):
        da, db = sdf_a(p), sdf_b(p)
        h = np.clip(0.5 + 0.5 * (db - da) / k, 0.0, 1.0)
        return db * (1 - h) + da * h - k * h * (1 - h)
    return f


def op_smooth_subtract(sdf_a, sdf_b, k=0.2):
    def f(p):
        da, db = sdf_a(p), sdf_b(p)
        h = np.clip(0.5 - 0.5 * (db + da) / k, 0.0, 1.0)
        return da * (1 - h) + (-db) * h + k * h * (1 - h)
    return f


def op_smooth_intersect(sdf_a, sdf_b, k=0.2):
    def f(p):
        da, db = sdf_a(p), sdf_b(p)
        h = np.clip(0.5 - 0.5 * (db - da) / k, 0.0, 1.0)
        return db * (1 - h) + da * h + k * h * (1 - h)
    return f


def op_round(sdf_fn, radius):
    """Uniformly round/offset a shape's whole boundary inward by `radius`
    (a "morphological erosion" in distance-field terms). This is the tool
    for method_selection.md's "filleted bracket corner": build the crisp
    body in csg_core, treat it as (or wrap it as) an SDF, then apply
    op_round for the one organic-looking rounded feature before remeshing.
    Note this rounds EVERY edge equally, unlike a per-edge CAD fillet --
    fine for a uniformly-softened look, not a substitute for a fillet that
    must apply to only one edge (build that as two csg_core parts instead
    and blend only at the shared boundary with op_smooth_union)."""
    def f(p):
        return sdf_fn(p) - radius
    return f


def sdf_from_mesh_proxy(mesh: trimesh.Trimesh):
    """Turn an already-built watertight trimesh into an SDF term (nearest-
    surface distance, signed via mesh.contains) so it can be combined with
    further organic SDF terms -- the crisp-body-plus-organic-feature bridge
    described in method_selection.md's "does a single part need both" case.
    Expensive per-call (a KD-tree query + a containment ray-cast per
    sample) -- fine for a handful of sdf_to_mesh grids, not for an inner
    loop over many animation frames."""
    if not mesh.is_watertight:
        raise SDFError("sdf_from_mesh_proxy requires an already-watertight mesh "
                        "-- run mesh_utils.repair_and_verify first.")
    from scipy.spatial import cKDTree
    tree = cKDTree(mesh.vertices)

    def f(p):
        dist, _ = tree.query(p, k=1)
        inside = mesh.contains(p)
        sign = np.where(inside, -1.0, 1.0)
        return dist * sign
    return f


# ---------------------------------------------------------------------------
# Meshing
# ---------------------------------------------------------------------------

def sdf_to_mesh(sdf_fn, bounds, resolution=0.02, name="sdf_part") -> trimesh.Trimesh:
    """Sample `sdf_fn` on a regular grid spanning `bounds = (lo_xyz,
    hi_xyz)` at `resolution` (grid spacing, same units as the SDF/scene)
    and extract the zero level-set with marching cubes.

    `resolution` is the smallest feature size you'll faithfully reproduce
    (method_selection.md) -- a blend radius or fillet smaller than roughly
    2x resolution will look faceted/lost. Raises SDFError rather than
    silently eating unbounded memory/time past ~12M voxels; treat that as
    "shrink bounds or coarsen resolution," not a bug to route around.
    """
    lo = np.asarray(bounds[0], dtype=float)
    hi = np.asarray(bounds[1], dtype=float)
    dims = np.maximum(((hi - lo) / resolution).astype(int) + 1, 2)
    if np.prod(dims) > 12_000_000:
        raise SDFError(f"'{name}': grid {tuple(dims)} too large ({np.prod(dims):,} "
                        "voxels) -- coarsen resolution or shrink bounds")

    # Tiny deterministic jitter on the sample grid. Without it, a
    # perfectly symmetric SDF (a centered sphere, a symmetric union) can
    # land exact grid samples exactly on the surface's symmetry planes,
    # which puts marching_cubes into an ambiguous saddle-face
    # configuration and produces a mesh that LOOKS fine but fails
    # is_watertight (a handful of non-manifold edges at those saddles).
    # Offsetting the grid by a sub-voxel amount makes that measure-zero
    # coincidence essentially never happen, at a cost far below
    # `resolution`'s own discretization error.
    jitter = resolution * 1e-3
    xs = np.linspace(lo[0], hi[0], dims[0]) + jitter
    ys = np.linspace(lo[1], hi[1], dims[1]) + jitter * 0.7
    zs = np.linspace(lo[2], hi[2], dims[2]) + jitter * 1.3
    gx, gy, gz = np.meshgrid(xs, ys, zs, indexing="ij")
    pts = np.stack([gx.ravel(), gy.ravel(), gz.ravel()], axis=-1)
    vals = sdf_fn(pts).reshape(dims)

    if vals.min() > 0 or vals.max() < 0:
        raise SDFError(f"'{name}': SDF never crosses zero within bounds "
                        f"(min={vals.min():.4f}, max={vals.max():.4f}) -- widen "
                        "bounds or check the shape is actually centered inside them")

    spacing = tuple((hi - lo) / (np.array(dims) - 1))
    verts, faces, normals, _values = measure.marching_cubes(vals, level=0.0, spacing=spacing)
    verts = verts + lo
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=True)

    if not mesh.is_watertight:
        raise SDFError(f"'{name}' meshed to a non-watertight surface "
                        f"({mesh.euler_number} euler number) -- the shape likely "
                        "touches/crosses the sampling bounds; pad bounds and retry "
                        "rather than shipping an open surface.")
    return mesh


def sdf_to_mesh_sequence(sdf_fn_of_t, t_values, bounds, resolution=0.02, name="sdf_anim"):
    """Mesh a time-varying SDF (e.g. a droplet neck thinning as it splits)
    at each value in `t_values`. Returns a list of (t, trimesh.Trimesh|None)
    -- None for any frame where the SDF failed to produce a watertight
    surface (e.g. a frame mid-pinch where the neck radius crosses zero and
    the topology briefly changes) rather than raising and losing the whole
    sequence; inspect which frames are None and treat that transition as
    meaningful, not as noise to suppress."""
    out = []
    for t in t_values:
        try:
            mesh = sdf_to_mesh(sdf_fn_of_t(t), bounds, resolution, name=f"{name}_t{t:.3f}")
        except SDFError:
            mesh = None
        out.append((t, mesh))
    return out
