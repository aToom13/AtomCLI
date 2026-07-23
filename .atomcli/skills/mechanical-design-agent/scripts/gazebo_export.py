"""
gazebo_export.py
=================
The last step of the pipeline: take a validated kinematics.Assembly (every
link watertight, every joint sweep-tested clean -- see physics_validate.py)
and write it out as a standard Gazebo model directory:

    <model_name>/
        model.config
        model.sdf
        meshes/
            <link_a>.stl
            <link_b>.stl
            ...
        VALIDATION.txt        (physics_validate.full_report output)

This directory is "plug and play": drop it in ~/.gazebo/models/ (or add its
parent to GAZEBO_MODEL_PATH) and `<include><uri>model://model_name</uri>
</include>` picks it up, or run `gz sim model_name/model.sdf` directly.

DESIGN NOTE on joint_type == "gear": SDF has no first-class "these two
revolute joints are mechanically coupled" primitive the way URDF+ROS
transmission plugins do. We emit both shafts as ordinary <joint
type="revolute"> and add a <plugin filename="libgazebo_gearbox.so"
name="gearbox_<name>"> that documents the ratio; if the exact plugin isn't
present on the target Gazebo install, this degenerates gracefully to two
independently-actuated revolute joints rather than a load-bearing structural
error at parse time. `physics_validate.gear_mesh_check` is what actually
proves the two gears are geometrically capable of meshing -- do not skip
running it before export just because the plugin covers the runtime
coupling.

REQUIRED PRE-CONDITION: call this only after physics_validate.full_report
comes back OVERALL: PASS. export_model() re-checks watertightness itself
(cheap, and this is exactly the kind of thing that's catastrophic to skip)
and raises GazeboExportError rather than writing a model a physics engine
will choke on.
"""
from __future__ import annotations
import os
import shutil
import xml.etree.ElementTree as ET
import xml.dom.minidom as minidom

import kinematics as kin
import mesh_utils
import physics_validate as pv


class GazeboExportError(RuntimeError):
    pass


_JOINT_TYPE_MAP = {
    "fixed": "fixed",
    "revolute": "revolute",
    "continuous": "revolute",   # SDF revolute w/ no limits = continuous
    "prismatic": "prismatic",
    "gear": "revolute",         # each shaft is its own revolute; see module docstring
}


def _pretty(elem) -> str:
    rough = ET.tostring(elem, encoding="unicode")
    return minidom.parseString(rough).toprettyxml(indent="  ")


def _add_inertial(link_elem, mass_props: dict):
    inertial = ET.SubElement(link_elem, "inertial")
    ET.SubElement(inertial, "mass").text = f"{mass_props['mass']:.8g}"
    cm = mass_props["center_mass"]
    pose = ET.SubElement(inertial, "pose")
    pose.text = f"{cm[0]:.8g} {cm[1]:.8g} {cm[2]:.8g} 0 0 0"
    I = mass_props["inertia"]
    inertia = ET.SubElement(inertial, "inertia")
    ET.SubElement(inertia, "ixx").text = f"{I[0][0]:.8g}"
    ET.SubElement(inertia, "ixy").text = f"{I[0][1]:.8g}"
    ET.SubElement(inertia, "ixz").text = f"{I[0][2]:.8g}"
    ET.SubElement(inertia, "iyy").text = f"{I[1][1]:.8g}"
    ET.SubElement(inertia, "iyz").text = f"{I[1][2]:.8g}"
    ET.SubElement(inertia, "izz").text = f"{I[2][2]:.8g}"


def _add_geometry(parent_elem, mesh_uri: str, scale=(1, 1, 1)):
    geometry = ET.SubElement(parent_elem, "geometry")
    mesh_el = ET.SubElement(geometry, "mesh")
    ET.SubElement(mesh_el, "uri").text = mesh_uri
    ET.SubElement(mesh_el, "scale").text = f"{scale[0]} {scale[1]} {scale[2]}"


def _add_link(model_elem, link: kin.Link, model_name: str):
    link_elem = ET.SubElement(model_elem, "link", name=link.name)
    ET.SubElement(link_elem, "self_collide").text = "true" if link.self_collide else "false"

    _add_inertial(link_elem, link.mass_props())

    visual = ET.SubElement(link_elem, "visual", name=f"{link.name}_visual")
    _add_geometry(visual, f"model://{model_name}/meshes/{link.name}.stl")
    material = ET.SubElement(visual, "material")
    ambient = ET.SubElement(material, "ambient")
    r, g, b = link.color
    ambient.text = f"{r} {g} {b} 1"
    ET.SubElement(material, "diffuse").text = f"{r} {g} {b} 1"

    collision = ET.SubElement(link_elem, "collision", name=f"{link.name}_collision")
    _add_geometry(collision, f"model://{model_name}/meshes/{link.name}.stl")


def _add_joint(model_elem, joint: kin.Joint):
    sdf_type = _JOINT_TYPE_MAP.get(joint.joint_type)
    if sdf_type is None:
        raise GazeboExportError(f"Unknown joint_type '{joint.joint_type}' on joint '{joint.name}'")

    joint_elem = ET.SubElement(model_elem, "joint", name=joint.name, type=sdf_type)
    ET.SubElement(joint_elem, "parent").text = joint.parent
    ET.SubElement(joint_elem, "child").text = joint.child
    pose = ET.SubElement(joint_elem, "pose")
    ox, oy, oz = joint.origin_xyz
    rr, rp, ry = [d * 3.141592653589793 / 180.0 for d in joint.origin_rpy_deg]
    pose.text = f"{ox:.8g} {oy:.8g} {oz:.8g} {rr:.8g} {rp:.8g} {ry:.8g}"

    if joint.joint_type != "fixed":
        axis = ET.SubElement(joint_elem, "axis")
        ax, ay, az = joint.axis
        ET.SubElement(axis, "xyz").text = f"{ax:.8g} {ay:.8g} {az:.8g}"
        limit = ET.SubElement(axis, "limit")
        if joint.joint_type != "continuous":
            lower = joint.lower if joint.lower is not None else -3.141592653589793
            upper = joint.upper if joint.upper is not None else 3.141592653589793
            ET.SubElement(limit, "lower").text = f"{lower:.8g}"
            ET.SubElement(limit, "upper").text = f"{upper:.8g}"
        ET.SubElement(limit, "effort").text = f"{joint.effort:.8g}"
        ET.SubElement(limit, "velocity").text = f"{joint.velocity:.8g}"

    if joint.joint_type == "gear":
        plugin = ET.SubElement(model_elem, "plugin",
                                filename="libgazebo_gearbox.so",
                                name=f"gearbox_{joint.name}")
        ET.SubElement(plugin, "joint1").text = joint.name
        ET.SubElement(plugin, "joint2").text = joint.gear_partner or ""
        ET.SubElement(plugin, "gear_ratio").text = f"{joint.gear_ratio if joint.gear_ratio is not None else 1.0:.8g}"


def build_sdf_xml(assembly: kin.Assembly, model_name: str) -> str:
    sdf = ET.Element("sdf", version="1.9")
    model = ET.SubElement(sdf, "model", name=model_name)
    ET.SubElement(model, "static").text = "false"

    for link in assembly.links.values():
        _add_link(model, link, model_name)
    for joint in assembly.joints.values():
        _add_joint(model, joint)

    return _pretty(sdf)


def build_model_config(model_name: str, description: str, author: str = "mechanical-design-agent",
                        email: str = "n/a", version: str = "1.0") -> str:
    cfg = ET.Element("model")
    ET.SubElement(cfg, "name").text = model_name
    ET.SubElement(cfg, "version").text = version
    sdf_el = ET.SubElement(cfg, "sdf", version="1.9")
    sdf_el.text = "model.sdf"
    author_el = ET.SubElement(cfg, "author")
    ET.SubElement(author_el, "name").text = author
    ET.SubElement(author_el, "email").text = email
    ET.SubElement(cfg, "description").text = description
    return _pretty(cfg)


def export_model(assembly: kin.Assembly, output_dir: str, description: str = "",
                  skip_validation: bool = False, joint_sweep_kwargs: dict = None) -> str:
    """Write the full plug-and-play Gazebo model directory for `assembly`
    under `output_dir/<assembly.name>/`. Returns that directory's path.

    Refuses (raises GazeboExportError) if any link fails a fresh
    watertightness check, unless skip_validation=True is passed explicitly
    -- this is a deliberate speed bump, not a formality: a non-watertight
    STL silently corrupts collision/inertia in every downstream physics
    step and is far cheaper to catch here than in a running simulation.
    """
    model_name = assembly.name
    model_dir = os.path.join(output_dir, model_name)
    meshes_dir = os.path.join(model_dir, "meshes")
    if os.path.exists(model_dir):
        shutil.rmtree(model_dir)
    os.makedirs(meshes_dir, exist_ok=True)

    bad = []
    for name, link in assembly.links.items():
        report = mesh_utils.check_watertight(link.mesh, name)
        if not report.is_watertight and not skip_validation:
            bad.append(str(report))
    if bad:
        raise GazeboExportError(
            "Refusing to export -- the following links are NOT watertight "
            "(fix with mesh_utils.repair_and_verify before export, or pass "
            "skip_validation=True to override at your own risk):\n" + "\n".join(bad)
        )

    for name, link in assembly.links.items():
        mesh_utils.export_stl(link.mesh, os.path.join(meshes_dir, f"{name}.stl"))

    with open(os.path.join(model_dir, "model.sdf"), "w") as fh:
        fh.write(build_sdf_xml(assembly, model_name))
    with open(os.path.join(model_dir, "model.config"), "w") as fh:
        fh.write(build_model_config(model_name, description))

    report_str = pv.full_report(assembly, joint_sweep_kwargs or {})
    with open(os.path.join(model_dir, "VALIDATION.txt"), "w") as fh:
        fh.write(report_str)

    return model_dir


def zip_model(model_dir: str, zip_path: str = None) -> str:
    """Convenience: zip the exported model directory for easy hand-off."""
    if zip_path is None:
        zip_path = model_dir.rstrip("/")
    base = zip_path[:-4] if zip_path.endswith(".zip") else zip_path
    return shutil.make_archive(base, "zip", root_dir=os.path.dirname(model_dir), base_dir=os.path.basename(model_dir))
