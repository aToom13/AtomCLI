"""
kinematics.py
=============
The data model that sits between "a pile of watertight meshes" and "a
Gazebo model with working joints": Link, Joint, and Assembly.

Design choice worth calling out: this mirrors URDF/SDF's own tree-of-rigid-
bodies-connected-by-joints model directly (Assembly.graph is a networkx
DiGraph, edges = joints, nodes = links, parent-to-child pointing away from
the root). That means anything you build here maps onto gazebo_export.py
almost mechanically, and anything physics_validate.py needs to simulate
(forward kinematics at an arbitrary joint configuration) is just a BFS
accumulation of 4x4 transforms down the tree -- no external physics engine
required for that part, it's pure rigid-body math.

Joint-axis estimation: when reverse-engineering from photos/description
rather than authoring parts with known joint geometry, `estimate_joint_axis
_from_contact` gives a principled starting guess (PCA on the near-contact
point patch between two parts). It is a heuristic, not a guarantee -- always
cross-check the result against the part's obvious symmetry axis.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import numpy as np
import trimesh
import networkx as nx


@dataclass
class Link:
    name: str
    mesh: trimesh.Trimesh            # authored in the link's OWN local frame
    density: float = 1000.0          # kg/m^3, default = water; override per material
    stl_path: Optional[str] = None   # populated once exported to disk
    self_collide: bool = False       # set True when this link must physically
                                      # contact ANOTHER link of the SAME model
                                      # (e.g. gear teeth) -- Gazebo ignores
                                      # intra-model contacts by default.
    color: tuple = (0.65, 0.65, 0.68)  # cosmetic RGB for the exported visual
    _mass_cache: Optional[dict] = field(default=None, repr=False)

    def mass_props(self) -> dict:
        if self._mass_cache is None:
            import mesh_utils
            self._mass_cache = mesh_utils.mass_properties(self.mesh, density=self.density)
        return self._mass_cache


@dataclass
class Joint:
    name: str
    parent: str
    child: str
    joint_type: str                  # "fixed" | "revolute" | "continuous" | "prismatic" | "gear"
    origin_xyz: tuple = (0.0, 0.0, 0.0)   # child-joint-frame origin, in the PARENT link's frame
    origin_rpy_deg: tuple = (0.0, 0.0, 0.0)
    axis: tuple = (0.0, 0.0, 1.0)     # in the joint frame; ignored for "fixed"
    lower: Optional[float] = None     # radians (revolute) or metres (prismatic)
    upper: Optional[float] = None
    effort: float = 50.0
    velocity: float = 10.0
    # For joint_type == "gear": name of the OTHER revolute joint this one is
    # kinematically coupled to, plus the signed ratio (see gazebo_export's
    # <gearbox> writer and physics_validate's gear_mesh_check).
    gear_partner: Optional[str] = None
    gear_ratio: Optional[float] = None


class Assembly:
    """A tree of Links connected by Joints, rooted at `root`."""

    def __init__(self, name: str):
        self.name = name
        self.links: dict[str, Link] = {}
        self.joints: dict[str, Joint] = {}
        self.graph = nx.DiGraph()
        self.root: Optional[str] = None

    # -- construction -------------------------------------------------
    def add_link(self, link: Link, is_root: bool = False):
        self.links[link.name] = link
        self.graph.add_node(link.name)
        if is_root or self.root is None:
            self.root = link.name
        return link

    def add_joint(self, joint: Joint):
        if joint.parent not in self.links or joint.child not in self.links:
            raise ValueError(f"Joint '{joint.name}' references a link that "
                              f"hasn't been added yet (parent={joint.parent}, "
                              f"child={joint.child})")
        self.joints[joint.name] = joint
        self.graph.add_edge(joint.parent, joint.child, joint=joint.name)
        return joint

    # -- kinematics -----------------------------------------------------
    @staticmethod
    def _joint_local_transform(joint: Joint, actuation: float) -> np.ndarray:
        """4x4 transform from parent link frame -> child link frame, at a
        given actuation value (radians for revolute/continuous, metres for
        prismatic, ignored for fixed/gear)."""
        T = trimesh.transformations.compose_matrix(
            angles=np.radians(joint.origin_rpy_deg), translate=joint.origin_xyz
        )
        if joint.joint_type in ("revolute", "continuous", "gear"):
            axis = np.asarray(joint.axis, dtype=float)
            axis = axis / np.linalg.norm(axis)
            T = T @ trimesh.transformations.rotation_matrix(actuation, axis)
        elif joint.joint_type == "prismatic":
            axis = np.asarray(joint.axis, dtype=float)
            axis = axis / np.linalg.norm(axis)
            slide = np.eye(4)
            slide[:3, 3] = axis * actuation
            T = T @ slide
        return T

    def forward_kinematics(self, actuation: Optional[dict] = None) -> dict:
        """{link_name: 4x4 world transform}. `actuation` maps joint name ->
        angle(rad)/distance(m); unlisted joints are held at 0.

        Raises ValueError if any added link isn't reachable from `root` by
        a chain of joints -- an Assembly models ONE connected kinematic
        tree, so a link with no path back to the root has no defined world
        transform. This is deliberately a loud, actionable error instead of
        silently omitting the link (which used to surface much later, and
        much less clearly, as a bare KeyError out of world_mesh()). Fix by
        either adding a 'fixed' joint connecting the orphan link into the
        tree, or -- if it genuinely isn't mechanically connected to
        anything else (e.g. two independent static props in one scene) --
        give it its own separate Assembly/export_model call instead of
        adding it to this one."""
        actuation = actuation or {}
        transforms = {self.root: np.eye(4)}
        for parent, child in nx.bfs_tree(self.graph, self.root).edges():
            jname = self.graph.edges[parent, child]["joint"]
            joint = self.joints[jname]
            a = actuation.get(jname, 0.0)
            transforms[child] = transforms[parent] @ self._joint_local_transform(joint, a)

        unreached = set(self.links) - set(transforms)
        if unreached:
            raise ValueError(
                f"Assembly '{self.name}': link(s) {sorted(unreached)} have no joint "
                f"path back to root '{self.root}', so they have no defined world "
                "transform. An Assembly is a single connected kinematic tree -- "
                "either add a 'fixed' joint connecting each of these into the tree, "
                "or give each one its own separate Assembly/export_model call if it "
                "really is an independent, unconnected body."
            )
        return transforms

    def world_mesh(self, link_name: str, transforms: Optional[dict] = None) -> trimesh.Trimesh:
        transforms = transforms if transforms is not None else self.forward_kinematics()
        m = self.links[link_name].mesh.copy()
        m.apply_transform(transforms[link_name])
        return m

    def all_world_meshes(self, actuation: Optional[dict] = None) -> dict:
        t = self.forward_kinematics(actuation)
        return {name: self.world_mesh(name, t) for name in self.links}

    def children_of(self, link_name: str) -> list:
        return list(self.graph.successors(link_name))

    def parent_of(self, link_name: str) -> Optional[str]:
        preds = list(self.graph.predecessors(link_name))
        return preds[0] if preds else None

    def joint_between(self, parent: str, child: str) -> Optional[Joint]:
        if self.graph.has_edge(parent, child):
            return self.joints[self.graph.edges[parent, child]["joint"]]
        return None

    def movable_joints(self) -> list:
        return [j for j in self.joints.values() if j.joint_type in ("revolute", "continuous", "prismatic")]


# ---------------------------------------------------------------------------
# Reverse-engineering heuristic: guess a revolute axis from where two parts
# nearly touch, instead of from an analytically-known parameter.
# ---------------------------------------------------------------------------

def estimate_joint_axis_from_contact(mesh_a: trimesh.Trimesh, mesh_b: trimesh.Trimesh,
                                      tolerance: float = 2e-3):
    """Find the near-contact patch between two parts and fit a plane to it
    via PCA. For a part riding on a shaft/bore (the overwhelmingly common
    case for a revolute joint), that patch is an annulus/ring perpendicular
    to the rotation axis, so:
        - the plane's normal (smallest-variance principal direction) IS the
          rotation axis
        - the patch centroid is a good estimate of the joint origin

    Returns (origin_xyz, axis_xyz) in whatever frame mesh_a/mesh_b's
    vertices are expressed in. This is a heuristic starting point for
    reverse-engineering from geometry alone -- always sanity-check the
    result against the part's visible symmetry before trusting it.
    """
    from scipy.spatial import cKDTree
    tree_b = cKDTree(mesh_b.vertices)
    dist, _ = tree_b.query(mesh_a.vertices, k=1)
    close = mesh_a.vertices[dist < tolerance]
    if len(close) < 6:
        raise ValueError(
            f"Only {len(close)} vertices of mesh_a fall within {tolerance} of "
            "mesh_b -- the parts may not actually be in contact. Widen "
            "`tolerance` or check that the two parts were placed correctly."
        )
    centroid = close.mean(axis=0)
    _, _, vt = np.linalg.svd(close - centroid)
    axis = vt[-1]
    return centroid, axis
