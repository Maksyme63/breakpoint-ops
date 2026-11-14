#!/usr/bin/env python3
"""Assemble les scripts de src/ en un fichier PortMirage.rbxlx ouvrable dans Roblox Studio.

Usage : python3 tools/build_place.py
"""
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
OUT = ROOT / "PortMirage.rbxlx"

_counter = 0


def _ref():
    global _counter
    _counter += 1
    return "RBX%d" % _counter


def item(class_name, name, children="", source=None):
    props = '<string name="Name">%s</string>' % escape(name)
    if source is not None:
        if "]]>" in source:
            raise ValueError("%s contient ']]>' : impossible a mettre dans un bloc CDATA" % name)
        props += '<ProtectedString name="Source"><![CDATA[%s]]></ProtectedString>' % source
    return '<Item class="%s" referent="%s"><Properties>%s</Properties>%s</Item>\n' % (
        class_name,
        _ref(),
        props,
        children,
    )


def scripts(folder):
    """Un Item par fichier .luau : *.server.luau = Script, *.client.luau = LocalScript, sinon ModuleScript."""
    out = ""
    for path in sorted(folder.glob("*.luau")):
        source = path.read_text(encoding="utf-8")
        if path.name.endswith(".server.luau"):
            out += item("Script", path.name[: -len(".server.luau")], source=source)
        elif path.name.endswith(".client.luau"):
            out += item("LocalScript", path.name[: -len(".client.luau")], source=source)
        else:
            out += item("ModuleScript", path.stem, source=source)
    return out


def main():
    body = ""
    body += item("Workspace", "Workspace")
    body += item("Lighting", "Lighting")
    body += item("ReplicatedStorage", "ReplicatedStorage", item("Folder", "Shared", scripts(SRC / "shared")))
    body += item("ServerScriptService", "ServerScriptService", item("Folder", "Server", scripts(SRC / "server")))
    body += item(
        "StarterPlayer",
        "StarterPlayer",
        item("StarterPlayerScripts", "StarterPlayerScripts", item("Folder", "Client", scripts(SRC / "client"))),
    )
    xml = (
        '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        'xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">\n'
        + body
        + "</roblox>\n"
    )
    OUT.write_text(xml, encoding="utf-8")
    print("Ecrit : %s (%d octets)" % (OUT, len(xml.encode("utf-8"))))


if __name__ == "__main__":
    main()
