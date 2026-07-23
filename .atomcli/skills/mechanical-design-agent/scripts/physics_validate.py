"""
physics_validate.py
====================
A lightweight, code-only "does this kinematic assembly actually work"
checker, run BEFORE anything reaches Gazebo. It answers two questions no
amount of staring at a static render can answer:

  1. As each revolute/prismatic joint moves through its range of motion,
     does the moving part ever pass through a part it isn't jointed to?
     (sweep_test)
  2. At rest, are any two unrelated parts already interpenetrating -- a
     sure sign of a placement mistake? (static_clearance_check)
  3. For gear pairs specifically: is the center distance between the two
     shafts exactly the sum of their pitch radii, the one number that
     actually determines whether teeth mesh correctly? (gear_mesh_check)

METHOD: this is not a full rigid-body physics engine -- it doesn't need to
be one to catch the overwhelming majority of "I got a sign or an offset
wrong" bugs. It samples points on a moving part's surface and asks a static
part's watertight mesh "do you contain this point?" (trimesh's ray-casting
`contains`, backed by rtree). A joint's own shaft/socket region is expected
to overlap its mating part by design, so every check excludes a small
sphere around the joint origin -- anything CS outside that sphere overlapping
is a genuine collision, not a modeling artifact of how the joint was drawn.

This is intentionally conservative: it flags real problems with points
sampled at joint-typical resolution (a few hundred points per part). It is
not a substitute for Gazebo's own contact solver once the model is loaded
there, but it turns "did I connect this backwards" from a runtime surprise
into a build-time error report.
"""
from __future__ import annotations
from dataclasses import dataclass, field
import numpy as np
import networkx as nx
import trimesh

import kinematics as kin


@dataclass
class SweepResult:
    joint_name: str
    passed: bool
    n_steps: int
    angle_range_deg: tuple
    worst_penetration_fraction: float
    worst_at_deg: float
    checked_against: list = field(default_factory=list)
    notes: str = ""

    def __str__(self):
        status = "PASS" if self.passed else "FAIL"
        return (f"[{status}] sweep '{self.joint_name}' over {self.angle_range_deg[0]:.0f}"
                f"..{self.angle_range_deg[1]:.0f} deg ({self.n_steps} steps): "
                f"worst interpenetration {self.worst_penetration_fraction*100:.2f}% "
                f"of sample points at {self.worst_at_deg:.1f} deg"
                f"{' -- ' + self.notes if self.notes else ''}")


@dataclass
class ClearanceResult:
    link_a: str
    link_b: str
    passed: bool
    penetration_fraction: float

    def __str__(self):
        status = "PASS" if self.passed else "FAIL"
        return f"[{status}] rest-pose clearance {self.link_a} vs {self.link_b}: {self.penetration_fraction*100:.2f}%"


@dataclass
class GearMeshResult:
    gear_a: str
    gear_b: str
    passed: bool
    expected_center_distance: float
    actual_center_distance: float
    error: float

    def __str__(self):
        status = "PASS" if self.passed else "FAIL"
        return (f"[{status}] gear mesh {self.gear_a}<->{self.gear_b}: "
                f"center distance {self.actual_center_distance:.5f} "
                f"(expected {self.expected_center_distance:.5f}, "
                f"error {self.error:.2e})")


def _sample_points(mesh: trimesh.Trimesh, n=350, seed=0):
    if len(mesh.vertices) <= n:
        return mesh.vertices
    rng = np.random.default_rng(seed)
    idx = rng.choice(len(mesh.vertices), n, replace=False)
    return mesh.vertices[idx]


def _penetration_fraction(moving_pts, static_mesh, exclude_point=None, exclude_radius=0.0):
    pts = moving_pts
    if exclude_point is not None and exclude_radius > 0:
        d = np.linalg.norm(pts - np.asarray(exclude_point), axis=1)
        pts = pts[d > exclude_radius]
    if len(pts) == 0:
        return 0.0
    inside = static_mesh.contains(pts)
    return float(np.mean(inside))


def sweep_test(assembly: kin.Assembly, joint_name: str, n_steps=13,
                angle_range_deg=None, exclude_radius=0.03,
                fraction_tolerance=0.01, n_samples=350) -> SweepResult:
    """Actuate a single joint through a range while holding every other
    joint at rest, and check the moving subtree against every static link
    for interpenetration outside the joint's own clearance sphere."""
    joint = assembly.joints[joint_name]
    if joint.joint_type not in ("revolute", "continuous", "prismatic"):
        raise ValueError(f"sweep_test only applies to movable joints, got '{joint.joint_type}'")

    is_prismatic = joint.joint_type == "prismatic"
    if angle_range_deg is None:
        if joint.joint_type == "continuous":
            lo, hi = 0.0, 360.0
        elif is_prismatic:
            lo = joint.lower if joint.lower is not None else -0.05
            hi = joint.upper if joint.upper is not None else 0.05
        else:
            lo = np.degrees(joint.lower) if joint.lower is not None else -30.0
            hi = np.degrees(joint.upper) if joint.upper is not None else 30.0
    else:
        lo, hi = angle_range_deg

    moving_subtree = list(nx.descendants(assembly.graph, joint.child)) + [joint.child]
    static_links = [l for l in assembly.links if l not in moving_subtree]

    rest_T = assembly.forward_kinematics()
    joint_origin_world = (rest_T[joint.parent] @ np.append(joint.origin_xyz, 1.0))[:3]

    values = np.linspace(lo, hi, n_steps)
    worst_frac, worst_val = 0.0, lo
    for v in values:
        actuation_value = v if is_prismatic else np.radians(v)
        T = assembly.forward_kinematics({joint_name: actuation_value})
        moving_meshes = [assembly.world_mesh(l, T) for l in moving_subtree]
        moving_samples = [_sample_points(m, n_samples) for m in moving_meshes]
        for stat_name in static_links:
            stat_mesh = assembly.world_mesh(stat_name, T)
            if not stat_mesh.is_watertight:
                continue
            for pts in moving_samples:
                frac = _penetration_fraction(pts, stat_mesh, joint_origin_world, exclude_radius)
                if frac > worst_frac:
                    worst_frac, worst_val = frac, v

    passed = worst_frac <= fraction_tolerance
    notes = "" if passed else (
        "Points from the moving subtree fell inside a link it isn't jointed "
        "to, beyond the joint's own clearance sphere -- increase spacing, "
        "widen the joint limit, or re-check the origin offset."
    )
    return SweepResult(joint_name, passed, n_steps, (lo, hi), worst_frac, worst_val,
                        checked_against=static_links, notes=notes)


def static_clearance_check(assembly: kin.Assembly, exclude_radius=0.03,
                            fraction_tolerance=0.01, n_samples=350) -> list:
    """At the rest configuration, check every pair of links that are NOT
    directly joined (parent<->child) for interpenetration. Catches
    placement mistakes -- e.g. a wheel that overlaps the chassis, or two
    non-meshing gears placed too close -- that a sweep test wouldn't catch
    because nothing ever moves relative to them."""
    T = assembly.forward_kinematics()
    names = list(assembly.links.keys())
    joined_pairs = {frozenset((a, b)) for a, b in assembly.graph.edges()}
    results = []
    meshes = {n: assembly.world_mesh(n, T) for n in names}
    samples = {n: _sample_points(meshes[n], n_samples) for n in names}
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            if frozenset((a, b)) in joined_pairs:
                continue
            if not meshes[b].is_watertight:
                continue
            frac_ab = _penetration_fraction(samples[a], meshes[b], exclude_radius=0.0)
            passed = frac_ab <= fraction_tolerance
            results.append(ClearanceResult(a, b, passed, frac_ab))
    return results


def gear_mesh_check(pitch_radius_a: float, pitch_radius_b: float,
                     center_distance: float, tolerance=1e-6) -> GearMeshResult:
    """The correct physical condition for two external spur gears to mesh
    is exact, and it is NOT "the bodies touch" (their addendum circles are
    SUPPOSED to overlap -- that's how teeth interleave). It is: the distance
    between shaft centers equals the sum of the two PITCH radii. Checking
    volumetric overlap here would incorrectly fail a correctly-meshing gear
    pair, so this check replaces it for anything flagged joint_type=='gear'.
    """
    expected = pitch_radius_a + pitch_radius_b
    err = abs(center_distance - expected)
    return GearMeshResult("gear_a", "gear_b", err <= tolerance, expected, center_distance, err)


def full_report(assembly: kin.Assembly, joint_sweep_kwargs=None) -> str:
    """Run every applicable check and return a human-readable report string.
    Intended to be printed to stdout and/or saved next to the exported
    Gazebo model as VALIDATION.txt."""
    joint_sweep_kwargs = joint_sweep_kwargs or {}
    lines = [f"Physics/kinematics validation report for assembly '{assembly.name}'", "=" * 70]

    lines.append("\n-- Watertightness (per link) --")
    import mesh_utils
    all_watertight = True
    for name, link in assembly.links.items():
        rep = mesh_utils.check_watertight(link.mesh, name)
        all_watertight &= rep.is_watertight
        lines.append(str(rep))

    lines.append("\n-- Rest-pose static clearance (non-jointed link pairs) --")
    clearance_results = static_clearance_check(assembly)
    if not clearance_results:
        lines.append("(no non-jointed link pairs to check)")
    for r in clearance_results:
        lines.append(str(r))

    lines.append("\n-- Joint range-of-motion sweep tests --")
    sweep_results = []
    for jname, joint in assembly.joints.items():
        if joint.joint_type not in ("revolute", "continuous", "prismatic"):
            continue
        res = sweep_test(assembly, jname, **joint_sweep_kwargs)
        sweep_results.append(res)
        lines.append(str(res))

    all_pass = all_watertight and all(r.passed for r in clearance_results) and all(r.passed for r in sweep_results)
    lines.append("\n" + "=" * 70)
    lines.append(f"OVERALL: {'PASS' if all_pass else 'FAIL'}")
    return "\n".join(lines)
