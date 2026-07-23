"""
csg_core.py
===========
Parametric-surface and CSG (Constructive Solid Geometry) primitives, built on
top of `manifold3d` -- a computational-geometry library that performs exact,
robust boolean operations and *guarantees* every output is a valid 2-manifold
(i.e. watertight, no self-intersections, consistent winding). This is the
right tool for mechanical parts: chassis plates, gear blanks, wheel hubs,
anything with flat faces, cut-outs, or bolt holes -- the things a real CAD
package would build with sketches + extrude/revolve/boolean, not with a blend
field.

Division of labour with sdf_core.py:
    - csg_core  -> hard-edged, mechanical, bolted/machined parts
    - sdf_core  -> organic, blended, "grown" shapes (trees, droplets, fillets
                   that must melt into one another)
A single part is free to mix both: e.g. build a gear blank with csg_core,
then round one edge with an SDF pass, then convert back. See
`from_trimesh`/`to_trimesh` below for crossing that bridge.

Every function here either returns a manifold3d.Manifold or raises CSGError
-- it never silently returns a broken shape. That is the main reason to
prefer this module over hand-rolled trimesh boolean calls: trimesh's boolean
backends (blender/scad) are not guaranteed manifold and fail silently on
messy input, which is exactly the failure mode this skill exists to avoid
before a mesh reaches a physics engine.
"""
from __future__ import annotations
import numpy as np
import trimesh
import manifold3d as m3d


class CSGError(RuntimeError):
    pass


def _check(man, op_name="operation"):
    if man.status() != m3d.Error.NoError:
        raise CSGError(f"CSG '{op_name}' failed with status: {man.status()}")
    if man.num_vert() == 0:
        raise CSGError(
            f"CSG '{op_name}' produced an empty solid. For boolean ops this "
            "usually means the inputs didn't actually overlap/touch as "
            "intended -- check part placement before combining."
        )
    return man


# ---------------------------------------------------------------------------
# Primitives
# ---------------------------------------------------------------------------

def box(size=(1.0, 1.0, 1.0), center=True):
    return _check(m3d.Manifold.cube(tuple(size), center), "box")


def cylinder(height, radius, radius_top=None, segments=64, center=True):
    """Capped cylinder. Set radius_top != radius for a frustum/cone-taper
    (handy for suspension-arm bosses or a wheel rim's bead seat)."""
    r_top = radius if radius_top is None else radius_top
    return _check(m3d.Manifold.cylinder(height, radius, r_top, segments, center), "cylinder")


def cone(height, radius, segments=64, center=True):
    return _check(m3d.Manifold.cylinder(height, radius, 0.0, segments, center), "cone")


def sphere(radius, segments=64):
    return _check(m3d.Manifold.sphere(radius, segments), "sphere")


def polygon_extrusion(points_2d, height, twist_degrees=0.0, scale_top=(1.0, 1.0), center=False):
    """Extrude an arbitrary closed 2D polygon (list of (x,y) points, wound
    either direction) along +Z. This is the tool for anything with a
    distinctive cross-section swept straight through: gear teeth, an
    I-beam chassis rail, an asymmetric bracket."""
    cs = m3d.CrossSection([list(map(tuple, points_2d))])
    man = cs.extrude(height, twist_degrees=twist_degrees, scale_top=tuple(scale_top))
    if center:
        man = man.translate([0, 0, -height / 2.0])
    return _check(man, "polygon_extrusion")


def polygon_revolve(points_2d, segments=96, revolve_degrees=360.0):
    """Revolve a 2D profile (points in the X>=0 half-plane, X = radius, Y =
    height along the eventual rotation axis) around the Y axis; the result's
    Z axis becomes the revolve axis. This is a lathe operation -- use it for
    wheel hubs, rims, bushings, anything round in cross-section."""
    cs = m3d.CrossSection([list(map(tuple, points_2d))])
    man = m3d.Manifold.revolve(cs, segments, revolve_degrees)
    return _check(man, "polygon_revolve")


def hull(*manifolds):
    """Convex hull of one or more manifolds -- occasionally the fastest
    correct way to build a simplified COLLISION geometry for a visually
    complex VISUAL mesh (see gazebo_export.py, which keeps visual and
    collision meshes separate for exactly this reason)."""
    if len(manifolds) == 1:
        return _check(manifolds[0].hull(), "hull")
    return _check(m3d.Manifold.batch_hull(list(manifolds)), "hull")


# ---------------------------------------------------------------------------
# Boolean combinators
# ---------------------------------------------------------------------------

def union(*manifolds):
    out = manifolds[0]
    for m in manifolds[1:]:
        out = out + m
    return _check(out, "union")


def subtract(a, b):
    """a with b's volume removed."""
    return _check(a - b, "subtract")


def intersect(a, b):
    return _check(a ^ b, "intersect")


# ---------------------------------------------------------------------------
# Placement helpers (thin wrappers so call sites read like a build sequence)
# ---------------------------------------------------------------------------

def translate(man, xyz):
    return man.translate(tuple(xyz))


def rotate(man, xyz_deg):
    """Euler angles in degrees, applied X then Y then Z in the global frame."""
    return man.rotate(tuple(xyz_deg))


def place(man, xyz=(0, 0, 0), rot_deg=(0, 0, 0)):
    """Rotate then translate -- the order you want 95% of the time when
    positioning a finished part into an assembly."""
    return man.rotate(tuple(rot_deg)).translate(tuple(xyz))


# ---------------------------------------------------------------------------
# Bridge to trimesh (for STL export, watertight re-verification, rendering,
# and interop with the sdf_core.py organic pipeline)
# ---------------------------------------------------------------------------

def to_trimesh(man) -> trimesh.Trimesh:
    mesh = man.to_mesh()
    verts = np.asarray(mesh.vert_properties)[:, :3]
    faces = np.asarray(mesh.tri_verts)
    return trimesh.Trimesh(vertices=verts, faces=faces, process=True)


def from_trimesh(tm: trimesh.Trimesh):
    """Bring a trimesh (e.g. one produced by sdf_core.sdf_to_mesh) into
    manifold3d so it can take part in further CSG booleans. The source mesh
    must already be watertight/manifold -- run mesh_utils.check_watertight
    first, this will raise CSGError instead of guessing if it isn't."""
    verts = np.ascontiguousarray(tm.vertices, dtype=np.float32)
    faces = np.ascontiguousarray(tm.faces, dtype=np.uint32)
    mesh = m3d.Mesh(vert_properties=verts, tri_verts=faces)
    man = m3d.Manifold(mesh)
    return _check(man, "from_trimesh")
