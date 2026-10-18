"""Build a Blender scene from the exported head model and render it.

Imports a .glb written by scripts/export-head-model.mjs (one object and
material per part), smooths the shading, optionally decimates every part
to a fraction of its triangles (to scale a detailed model down to a
low-poly one), saves a .blend file, renders a three-quarter view and can
write the result back out as glTF.

Usage (Blender 4.2 LTS or newer, no GUI needed):
  blender --background --factory-startup \
    --python scripts/blender/head_model.py -- \
    --glb models/head-male-lod3.glb --blend head.blend --render head.png \
    [--decimate 0.5] [--export head-decimated.glb] [--size 800] \
    [--hide head]
"""

import argparse
import math
import sys

import bpy
from mathutils import Vector


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--glb", required=True, help="head model to import")
    parser.add_argument("--blend", help="write the scene to this .blend file")
    parser.add_argument("--render", help="render a PNG to this path")
    parser.add_argument("--export", help="write the scene back out as .glb")
    parser.add_argument(
        "--decimate",
        type=float,
        default=1.0,
        help="keep this fraction of the triangles of every part (0..1]",
    )
    parser.add_argument("--size", type=int, default=800, help="render size")
    parser.add_argument(
        "--hide",
        default="",
        help="comma-separated parts to leave out of the render, e.g. head",
    )
    return parser.parse_args(argv)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def import_model(path):
    bpy.ops.import_scene.gltf(filepath=path)
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def decimate(objects, ratio):
    """Collapse edges until each part keeps `ratio` of its triangles."""
    for obj in objects:
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new("Decimate", "DECIMATE")
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def smooth(objects):
    for obj in objects:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True


def bounds(objects):
    corners = [
        obj.matrix_world @ Vector(corner)
        for obj in objects
        for corner in obj.bound_box
    ]
    low = Vector([min(c[axis] for c in corners) for axis in range(3)])
    high = Vector([max(c[axis] for c in corners) for axis in range(3)])
    return low, high


def stage(objects, size):
    """Camera at a three-quarter view of the face, a key and a fill light."""
    low, high = bounds(objects)
    centre = (low + high) / 2
    radius = (high - low).length / 2
    scene = bpy.context.scene
    # glTF +z forward is Blender -y after import: look from the front right.
    direction = Vector((0.55, -1.0, 0.2)).normalized()
    bpy.ops.object.camera_add(location=centre + direction * radius * 2.8)
    camera = bpy.context.object
    camera.data.lens = 50
    track = camera.constraints.new("TRACK_TO")
    target = bpy.data.objects.new("Target", None)
    target.location = centre
    scene.collection.objects.link(target)
    track.target = target
    scene.camera = camera
    for energy, offset in ((4.0, (2, -3, 3)), (1.5, (-3, -1, 1))):
        bpy.ops.object.light_add(
            type="SUN", location=centre + Vector(offset) * radius
        )
        light = bpy.context.object
        light.data.energy = energy
        light.rotation_euler = (
            (centre - light.location).to_track_quat("-Z", "Y").to_euler()
        )
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 32
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.world = scene.world or bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.9, 0.9, 0.9, 1)
    background.inputs["Strength"].default_value = 0.6


def triangles(objects):
    return sum(
        sum(len(polygon.vertices) - 2 for polygon in obj.data.polygons)
        for obj in objects
    )


def main():
    args = parse_args()
    clear_scene()
    objects = import_model(args.glb)
    before = triangles(objects)
    if args.decimate < 1:
        decimate(objects, args.decimate)
    smooth(objects)
    print(
        f"head_model: {len(objects)} parts, {before} -> "
        f"{triangles(objects)} triangles"
    )
    for obj in sorted(objects, key=lambda item: item.name):
        print(f"head_model: part {obj.name} {triangles([obj])} triangles")
    if args.export:
        # Before staging, so the camera and lights stay out of the file.
        bpy.ops.export_scene.gltf(filepath=args.export, export_format="GLB")
    if args.render:
        hidden = set(filter(None, args.hide.split(",")))
        for obj in objects:
            obj.hide_render = obj.name in hidden
        stage([obj for obj in objects if not obj.hide_render], args.size)
        bpy.context.scene.render.filepath = args.render
        bpy.ops.render.render(write_still=True)
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=args.blend)


if __name__ == "__main__":
    main()
