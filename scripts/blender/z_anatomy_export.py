"""Export the vocal tract organs of the Z-Anatomy atlas as STL files.

Z-Anatomy (CC BY-SA 4.0, https://github.com/Z-Anatomy/Models-of-human-anatomy)
ships one 300 MB Startup.blend holding the whole body. Loading it all
needs more than 11 GB of memory, so only the named objects are appended
(their meshes come along, the rest of the file is never read). Each one
is written in world coordinates, with its modifiers applied, as a binary
STL in millimetres.

Never run the add-on scripts bundled with the atlas, and open the file
with --factory-startup --disable-autoexec so none of its scripts run:
  blender --background --factory-startup --disable-autoexec \
    --python scripts/blender/z_anatomy_export.py -- \
    --blend /path/to/Startup.blend --out /path/to/stl [--list]
"""

import argparse
import os
import struct
import sys

import bpy

# Mouth, pharynx and larynx: the walls that shape the sound.
OBJECTS = [
    "Mandible",
    "Maxilla.l",
    "Maxilla.r",
    "Palatine bone.l",
    "Palatine bone.r",
    "Tongue",
    "Soft palate",
    "Uvula of palate",
    "Nasopharynx",
    "Oropharynx",
    "Laryngopharynx",
    "Epiglottis",
    "Hyoid bone",
    "Thyroid cartilage",
    "Cricoid cartilage",
    "Arytenoid cartilage.l",
    "Arytenoid cartilage.r",
    "Trachea",
    "Gingiva",
    "Mucosa of nasal cavity",
    "Orbicularis oris muscle.l",
    "Orbicularis oris muscle.r",
]

TEETH = [
    "medial incisor",
    "lateral incisor",
    "canine",
    "first premolar",
    "second premolar",
    "first molar tooth",
    "second molar tooth",
]


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--blend", required=True, help="Z-Anatomy Startup.blend")
    parser.add_argument("--out", required=True, help="directory for the STLs")
    parser.add_argument(
        "--list", action="store_true", help="only print the matching names"
    )
    return parser.parse_args(argv)


def wanted_names():
    teeth = [
        f"{jaw} {tooth}.{side}"
        for jaw in ("Upper", "Lower")
        for tooth in TEETH
        for side in ("l", "r")
    ]
    return OBJECTS + teeth


def append(path, names):
    """Append the named objects (no linking, so nothing stays tied to the file)."""
    with bpy.data.libraries.load(path, link=False) as (source, target):
        available = set(source.objects)
        target.objects = [name for name in names if name in available]
        missing = [name for name in names if name not in available]
    objects = [obj for obj in target.objects if obj is not None]
    for obj in objects:
        bpy.context.scene.collection.objects.link(obj)
    return objects, missing


def export(obj, directory):
    """World-space, evaluated mesh as a binary STL in millimetres."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    mesh.transform(obj.matrix_world)
    mesh.calc_loop_triangles()
    name = obj.name.replace(" ", "_")
    path = os.path.join(directory, f"{name}.stl")
    # Blender works in metres; the atlas is modelled at life size.
    scale = 1000 * bpy.context.scene.unit_settings.scale_length
    with open(path, "wb") as handle:
        handle.write(b"Z-Anatomy CC BY-SA 4.0 ".ljust(80, b" "))
        handle.write(len(mesh.loop_triangles).to_bytes(4, "little"))
        for triangle in mesh.loop_triangles:
            corners = [mesh.vertices[index].co for index in triangle.vertices]
            values = [0.0, 0.0, 0.0]
            for corner in corners:
                values.extend(corner[axis] * scale for axis in range(3))
            handle.write(struct.pack("<12fH", *values, 0))
    count = len(mesh.loop_triangles)
    evaluated.to_mesh_clear()
    return path, count


def main():
    args = parse_args()
    names = wanted_names()
    if args.list:
        with bpy.data.libraries.load(args.blend, link=False) as (source, _):
            available = set(source.objects)
        for name in names:
            print(f"z_anatomy: {'found' if name in available else 'missing'} {name}")
        return
    objects, missing = append(args.blend, names)
    for name in missing:
        print(f"z_anatomy: missing {name}")
    os.makedirs(args.out, exist_ok=True)
    for obj in sorted(objects, key=lambda item: item.name):
        if obj.type != "MESH":
            print(f"z_anatomy: skip {obj.name} ({obj.type})")
            continue
        path, count = export(obj, args.out)
        print(f"z_anatomy: wrote {path} {count} triangles")


if __name__ == "__main__":
    main()
