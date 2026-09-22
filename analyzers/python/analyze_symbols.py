#!/usr/bin/env python3
"""Analyze Python workspace symbols into a JSON graph for Planisphere."""

from __future__ import annotations

import ast
import builtins
import json
import os
import sys
from collections import defaultdict
from dataclasses import dataclass, asdict
from typing import Dict, Iterable, List, Optional, Set, Tuple

# Unbound refs like `isinstance(x, set)` must not match a project symbol named `set`.
BUILTIN_NAMES = frozenset(dir(builtins))

SKIP_DIR_NAMES = {
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "venv",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    ".tox",
    ".eggs",
    "node_modules",
    "dist",
    "build",
    ".idea",
    ".vscode",
    # Test trees — keep library structure graphs free of test hubs.
    "tests",
    "test",
    "__tests__",
    "testing",
    # Docs / samples — not part of the library symbol structure.
    "docs",
    "examples",
}

# Symbol-less modules that should not become lone file nodes. Python's
# convention has a name; this is the set the contract lets an analyzer declare.
NOISE_FILE_NODE_NAMES = frozenset(
    {
        "__init__.py",
        "version.py",
        "_version.py",
    }
)


def is_only_re_exports(tree: ast.AST) -> bool:
    """Does this module declare nothing of its own — only imports?

    A named set reaches a convention that has a name and reaches nothing else.
    `fastapi/requests.py` is one line, `from starlette.requests import
    HTTPConnection as HTTPConnection`, and `cElementTree.py` is a deprecated
    alias for another module: re-export shims called by their own names, which
    no list would have held.

    A docstring is not a declaration. A module holding an assignment is content,
    however little, and stays.
    """
    body = list(getattr(tree, "body", []))
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
        if isinstance(body[0].value.value, str):
            body = body[1:]
    if not body:
        return False
    return all(isinstance(node, (ast.Import, ast.ImportFrom)) for node in body)


def is_test_python_file(filename: str) -> bool:
    """True for common pytest / unittest module names."""
    base = os.path.basename(filename)
    if base == "conftest.py":
        return True
    if not base.endswith(".py"):
        return False
    stem = base[:-3]
    return stem.startswith("test_") or stem.endswith("_test")


def iter_py_files(roots: Iterable[str]) -> List[str]:
    files: List[str] = []
    for root in roots:
        root = os.path.abspath(root)
        if os.path.isfile(root) and root.endswith(".py"):
            if not is_test_python_file(root):
                files.append(root)
            continue
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [
                d
                for d in dirnames
                if d not in SKIP_DIR_NAMES and not d.endswith(".egg-info")
            ]
            for name in filenames:
                if not name.endswith(".py"):
                    continue
                if is_test_python_file(name):
                    continue
                files.append(os.path.join(dirpath, name))
    files.sort()
    return files


@dataclass
class Node:
    id: str
    kind: str  # class | function | file
    name: str
    file: str
    line: int
    endLine: Optional[int] = None


def node_id(file_path: str, kind: str, name: str) -> str:
    return f"{file_path}::{kind}::{name}"


def base_name(node: ast.expr) -> Optional[str]:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


class ModuleInfo:
    def __init__(self, file_path: str, tree: ast.AST):
        self.file_path = file_path
        self.tree = tree
        self.symbol_nodes: List[Node] = []
        # local simple name -> node id (classes and top-level functions)
        self.local_symbols: Dict[str, str] = {}
        # import alias / name -> unresolved module path hints or symbol names
        # binding: local_name -> ("module", module_file_guess) or ("name", exported_name, from_module)
        self.import_bindings: Dict[str, Tuple] = {}
        self.class_defs: List[ast.ClassDef] = []
        self.func_defs: List[ast.AST] = []  # FunctionDef | AsyncFunctionDef
        # Names this file binds somewhere of its own: parameters, loop
        # variables, assignments, nested definitions. What such a name means
        # here is that binding, not a symbol elsewhere that happens to be
        # spelled the same. See `_module_bound_names`.
        self.bound_names: Set[str] = set()


def _put_symbol(info: "ModuleInfo", node: Node) -> None:
    """Record a top-level symbol, replacing an earlier declaration of the same one.

    A file may declare the same top-level name more than once — `@overload`
    makes it idiomatic — and every declaration computes the same id, so
    appending each one produces nodes no consumer can tell apart. The last
    declaration is kept: it is what the name means once the module has run,
    and under `@overload` it is the function rather than a signature stub.
    """
    for i, existing in enumerate(info.symbol_nodes):
        if existing.id == node.id:
            info.symbol_nodes[i] = node
            return
    info.symbol_nodes.append(node)


def parse_module(file_path: str) -> Optional[ModuleInfo]:
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            source = f.read()
        tree = ast.parse(source, filename=file_path)
    except (SyntaxError, UnicodeDecodeError, OSError):
        return None

    info = ModuleInfo(file_path, tree)
    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            nid = node_id(file_path, "class", node.name)
            _put_symbol(
                info,
                Node(
                    id=nid,
                    kind="class",
                    name=node.name,
                    file=file_path,
                    line=node.lineno,
                    endLine=getattr(node, "end_lineno", None),
                ),
            )
            info.local_symbols[node.name] = nid
            info.class_defs.append(node)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            nid = node_id(file_path, "function", node.name)
            _put_symbol(
                info,
                Node(
                    id=nid,
                    kind="function",
                    name=node.name,
                    file=file_path,
                    line=node.lineno,
                    endLine=getattr(node, "end_lineno", None),
                ),
            )
            info.local_symbols[node.name] = nid
            info.func_defs.append(node)

    _collect_module_imports(info, tree.body)
    # After the imports, because the two lists the filter must not touch are
    # `local_symbols` and `import_bindings` — the answers steps 1 and 2 give.
    info.bound_names = _module_bound_names(tree, info)

    if not info.symbol_nodes:
        base = os.path.basename(file_path)
        if base not in NOISE_FILE_NODE_NAMES and not is_only_re_exports(tree):
            info.symbol_nodes.append(
                Node(
                    id=node_id(file_path, "file", base),
                    kind="file",
                    name=base,
                    file=file_path,
                    line=1,
                    endLine=1,
                )
            )
    return info


def _record_imports(info: ModuleInfo, node: ast.AST) -> None:
    """Record one import statement.

    ``from`` bindings keep the relative ``level`` so ``from .routing import X``
    resolves against the importing file's own package rather than matching any
    module whose path happens to end in ``routing.py``.
    """
    if isinstance(node, ast.Import):
        for alias in node.names:
            if alias.asname:
                # `import a.b.c as x` binds x to the module a.b.c
                info.import_bindings[alias.asname] = ("module", 0, alias.name)
            else:
                # `import a.b.c` binds the top-level name `a`
                top = alias.name.split(".")[0]
                info.import_bindings[top] = ("module", 0, top)
    elif isinstance(node, ast.ImportFrom):
        module = node.module or ""
        level = node.level or 0
        for alias in node.names:
            if alias.name == "*":
                continue
            local = alias.asname or alias.name
            info.import_bindings[local] = ("from", level, module, alias.name)


def _collect_module_imports(info: ModuleInfo, body: Iterable[ast.stmt]) -> None:
    """Record imports at module level, including those guarded by ``if`` or ``try``.

    ``if TYPE_CHECKING:`` and ``try: import x / except ImportError:`` are ordinary
    ways to import a name; skipping them loses real references and pushes them
    onto the guess-by-unique-name path.
    """
    for node in body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            _record_imports(info, node)
        elif isinstance(node, ast.If):
            _collect_module_imports(info, node.body)
            _collect_module_imports(info, node.orelse)
        elif isinstance(node, ast.Try):
            _collect_module_imports(info, node.body)
            for handler in node.handlers:
                _collect_module_imports(info, handler.body)
            _collect_module_imports(info, node.orelse)
            _collect_module_imports(info, node.finalbody)


def module_file_candidates(roots: List[str], module_name: str) -> List[str]:
    """Map dotted module name to possible .py file paths under roots."""
    if not module_name:
        return []
    rel = module_name.replace(".", os.sep)
    candidates = []
    for root in roots:
        root = os.path.abspath(root)
        direct = os.path.join(root, rel + ".py")
        pkg = os.path.join(root, rel, "__init__.py")
        # also try relative to parent packages already under root walk — search by suffix
        if os.path.isfile(direct):
            candidates.append(direct)
        if os.path.isfile(pkg):
            candidates.append(pkg)
    return candidates


def analyze(roots: List[str]) -> dict:
    abs_roots = [os.path.abspath(r) for r in roots]
    files = iter_py_files(abs_roots)
    modules: List[ModuleInfo] = []
    for path in files:
        info = parse_module(path)
        if info is not None:
            modules.append(info)

    nodes: List[Node] = []
    for m in modules:
        nodes.extend(m.symbol_nodes)

    # Indexes
    by_id: Dict[str, Node] = {n.id: n for n in nodes}
    # name -> list of node ids (class/function only for linking)
    global_by_name: Dict[str, List[str]] = defaultdict(list)
    for n in nodes:
        if n.kind in ("class", "function"):
            global_by_name[n.name].append(n.id)

    # file -> module local symbols
    file_locals: Dict[str, Dict[str, str]] = {
        m.file_path: m.local_symbols for m in modules
    }

    # Every path a module name could name, indexed once.
    #
    # A module name matches by path components, not characters. Tested with
    # `path.endswith(rel)`, `import time` with no `time.py` in the tree would
    # match `_pydatetime.py`, because that name happens to end in those seven
    # characters — 75 such edges in CPython's standard library, including
    # `Random -> timeit.repeat` for what is `itertools.repeat`. Split on the
    # separator, a component either matches or it does not.
    #
    # An index rather than a scan of every file per import, because the
    # fallback fires far more than it looks: analysing `<repo>/<pkg>` while the
    # code says `import <pkg>.x` sends the direct lookup above to
    # `<root>/<pkg>/<pkg>/x.py`, which never exists. Django hits this 10052
    # times against 1 direct hit; as a scan that is nine million path
    # comparisons for 906 files, and Home Assistant, at eleven times the files,
    # would not finish in twenty minutes.
    #
    # First in file order wins. What the index decides is what matches, not
    # which of several genuine matches is chosen.
    module_suffix_index: Dict[str, str] = {}
    for path in file_locals:
        base = path[:-3] if path.endswith(".py") else path
        # A package is named by its directory, not by its `__init__`.
        if base.endswith(os.sep + "__init__"):
            base = base[: -len(os.sep + "__init__")]
        comps = base.split(os.sep)
        for i in range(len(comps)):
            module_suffix_index.setdefault(os.sep.join(comps[i:]), path)

    def module_file_for(
        importer: str, level: int, dotted: str
    ) -> Optional[str]:
        """Map an import target to a scanned file, or None when it is external.

        Relative imports resolve against the importing file's own package, so
        `from .routing import X` in `fastapi/` cannot match some other project's
        `routing.py` that merely shares a suffix.
        """
        parts = [p for p in dotted.split(".") if p]
        if level > 0:
            base = os.path.dirname(os.path.abspath(importer))
            for _ in range(level - 1):
                base = os.path.dirname(base)
            target = os.path.join(base, *parts) if parts else base
            for cand in (target + ".py", os.path.join(target, "__init__.py")):
                if cand in file_locals:
                    return cand
            return None
        for root in abs_roots:
            target = os.path.join(root, *parts)
            for cand in (target + ".py", os.path.join(target, "__init__.py")):
                if cand in file_locals:
                    return cand
        return module_suffix_index.get(os.sep.join(parts))

    def binding_module_file(module: ModuleInfo, local_name: str) -> Optional[str]:
        """File of the module a local name is bound to, if it is bound to one.

        Covers both `import pkg.mod` and `from pkg import mod` — the latter looks
        like a symbol import but actually binds a submodule, which is how
        `routing.APIRouter` and `params.Depends` are written.
        """
        binding = module.import_bindings.get(local_name)
        if not binding:
            return None
        if binding[0] == "module":
            _, level, dotted = binding
            return module_file_for(module.file_path, level, dotted)
        _, level, mod, exported = binding
        dotted = f"{mod}.{exported}" if mod else exported
        return module_file_for(module.file_path, level, dotted)

    def resolve_from_import(
        importer: str, level: int, module_name: str, exported: str
    ) -> Optional[str]:
        src_file = module_file_for(importer, level, module_name)
        if src_file is not None:
            locals_map = file_locals.get(src_file)
            if locals_map and exported in locals_map:
                return locals_map[exported]
        # The name was not found in the module it was imported from. Guessing by
        # unique global name recovers re-exports (`from pkg._compat import X`
        # where `_compat/__init__.py` re-exports X), but only when the import
        # target is part of this project. Without that guard, an import of
        # `starlette.responses.Response` links to a project class that merely
        # shares the name — a confident, wrong edge.
        if level > 0 or src_file is not None:
            ids = global_by_name.get(exported, [])
            if len(ids) == 1:
                return ids[0]
        return None

    def resolve_binding(module: ModuleInfo, local_name: str) -> Optional[str]:
        binding = module.import_bindings.get(local_name)
        if not binding:
            return None
        if binding[0] == "from":
            _, level, mod, exported = binding
            return resolve_from_import(module.file_path, level, mod, exported)
        # bare module import — the name is a module, not a symbol node
        return None

    module_by_file: Dict[str, ModuleInfo] = {m.file_path: m for m in modules}

    def module_export(
        mod_file: str, attr: str, seen: Optional[Set[str]] = None
    ) -> Optional[str]:
        """`attr` as a module exports it — what it defines, or what it re-exports.

        `file_locals` holds what a module *defines*. A package that says
        `from .migration import Migration` in its `__init__.py` exports the name
        without defining it, so a lookup that reads only the locals stops there.
        Every one of Django's twenty-four migrations is written that way, and
        a lookup of the locals alone resolves none of their base classes.

        Follows the binding the source actually writes, and only that: where the
        chain leaves the project the answer is None, not a project symbol that
        happens to share the name. Star imports are skipped for the same reason
        — what `from .x import *` binds depends on `__all__` and on what that
        module defines, which is inference rather than something the source
        states. `_record_imports` does not record them at all.

        Stops on a module already visited in this lookup. Cycles are the reason
        to stop, so "this module again" is the condition; a hop limit would also
        silently give up on a long legitimate chain.
        """
        if seen is None:
            seen = set()
        if mod_file in seen:
            return None
        seen.add(mod_file)
        local = file_locals.get(mod_file, {}).get(attr)
        if local is not None:
            return local
        info = module_by_file.get(mod_file)
        if info is None:
            return None
        binding = info.import_bindings.get(attr)
        if not binding or binding[0] != "from":
            return None
        _, level, mod, exported = binding
        if not mod and not level:
            return None
        src = module_file_for(mod_file, level, mod)
        if src is None:
            return None
        return module_export(src, exported, seen)

    def resolve_module_attr(
        module: ModuleInfo, base: str, attr: str
    ) -> Optional[str]:
        """Resolve `base.attr` where `base` is bound to a project module."""
        mod_file = binding_module_file(module, base)
        if mod_file is None:
            return None
        return module_export(mod_file, attr)

    edges: List[dict] = []
    # An ordered pair carries one edge, the most specific that applies. Deciding
    # that here rather than at the call sites is what makes it independent of
    # the order the pair is reached in — and it is reached more than once: a
    # file that declares a symbol several times is linked once per declaration,
    # so an `@overload` signature can name a class in an annotation while the
    # implementation calls it, and the two arrive from two separate calls.
    EDGE_RANK = {"inherits": 0, "uses": 1, "references": 2}
    edge_at: Dict[Tuple[str, str], int] = {}

    def add_edge(frm: str, to: str, kind: str) -> None:
        if frm == to:
            return
        if frm not in by_id or to not in by_id:
            return
        at = edge_at.get((frm, to))
        if at is None:
            edge_at[(frm, to)] = len(edges)
            edges.append({"from": frm, "to": to, "kind": kind})
            return
        if EDGE_RANK[kind] < EDGE_RANK[edges[at]["kind"]]:
            edges[at]["kind"] = kind

    def resolve_name_ref(module: ModuleInfo, name: str, self_id: str) -> Optional[str]:
        # 1) same-module
        if name in module.local_symbols:
            target = module.local_symbols[name]
            if target != self_id:
                return target
            return None
        # 2) import binding
        imported = resolve_binding(module, name)
        if imported and imported != self_id:
            return imported
        if name in module.import_bindings:
            # The name's origin is known: it was imported. If step 2 could not
            # resolve it, the import target is outside this project, so the name
            # denotes an external symbol. Guessing on from here would attach
            # `starlette.responses.Response` to an unrelated project class of
            # the same name.
            return None
        # 3) unique global — skip builtins (set/list/dict/…)
        if name in BUILTIN_NAMES:
            return None
        ids = [i for i in global_by_name.get(name, []) if i != self_id]
        if len(ids) == 1:
            return ids[0]
        return None

    # inherits
    for m in modules:
        for cls in m.class_defs:
            src = m.local_symbols[cls.name]
            for base in cls.bases:
                # `class X(routing.Router)` resolves through the bound module
                # first; falling straight to the bare attribute would let the
                # unique-global guess attach an external base to a same-named
                # project class.
                target = None
                if isinstance(base, ast.Attribute) and isinstance(
                    base.value, ast.Name
                ):
                    target = resolve_module_attr(m, base.value.id, base.attr)
                if target is None:
                    bname = base_name(base)
                    if not bname:
                        continue
                    target = resolve_name_ref(m, bname, src)
                if target and by_id[target].kind == "class":
                    add_edge(src, target, "inherits")

    # uses / references — class bodies (incl. methods) and top-level function
    # bodies and signatures.
    #
    # A name in an executable position (call, isinstance, default, decorator)
    # becomes `uses`; a name appearing only inside a type annotation becomes
    # `references`. Which of the two an ordered pair keeps is `add_edge`'s to
    # decide — it holds one edge per pair and only ever strengthens it:
    #   inherits > uses > references
    # The loops below do not guard the precedence themselves: that holds only
    # while both halves of a pair arrive from the same call.
    def resolve_ref(m: ModuleInfo, ref: object, src: str) -> Optional[str]:
        if isinstance(ref, tuple):
            return resolve_module_attr(m, ref[0], ref[1])
        return resolve_name_ref(m, str(ref), src)

    def link_owner(m: ModuleInfo, owner: ast.AST, own_name: str, src: str) -> None:
        used, annotated = _referenced_names(owner, m.bound_names)
        for ref in used:
            if ref == own_name:
                continue
            target = resolve_ref(m, ref, src)
            if target:
                add_edge(src, target, "uses")
        for ref in annotated:
            if ref == own_name:
                continue
            target = resolve_ref(m, ref, src)
            if not target:
                continue
            add_edge(src, target, "references")

    for m in modules:
        for cls in m.class_defs:
            link_owner(m, cls, cls.name, m.local_symbols[cls.name])
        for fn in m.func_defs:
            assert isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef))
            link_owner(m, fn, fn.name, m.local_symbols[fn.name])

    # Sorted, because the artifact is a file people keep.
    #
    # Reference collection runs through sets, and Python randomises string
    # hashing per process, so unsorted, the same analyzer over the same source
    # would write the edges in a different order every run. The graph would be
    # identical and the bytes not, which makes every re-analysis a diff nobody
    # can read and makes "did this change anything?" impossible to answer by
    # comparing files. Node order is stable by construction; edge order is not.
    return {
        "nodes": [asdict(n) for n in nodes],
        "edges": sorted(edges, key=lambda e: (e["from"], e["to"], e["kind"])),
    }


def _module_bound_names(tree: ast.AST, info: "ModuleInfo") -> Set[str]:
    """Every name this file binds of its own.

    The analyzer resolves a name in three steps: this module's symbols, this
    module's imports, then — if neither answered — the whole project, taken if
    exactly one symbol anywhere is spelled that way. Left alone, the third step
    takes names bound right there in the file: `_ComplexBinder.__create_handler`
    writes `for f in l: f(event)`, and `f` would become a dependency on the
    project's only module-level `f`, in `turtledemo/chaos.py`.

    The reference collector walks the tree for `Name` nodes and knows only the
    module-level symbol table, so a function's own parameters and locals look
    like references to something outside. This is the list it needs.

    Two kinds of binding are deliberately left out, because they are what steps
    1 and 2 answer with:

    * module-level `def` and `class` — they are `local_symbols`, and filtering
      them would delete every edge inside a file;
    * `import` and `from ... import`, wherever they appear — a name bound by an
      import denotes the imported symbol, which is exactly what a reference to
      it means. Only the module-level ones are `import_bindings`, so the walk
      collects the rest itself: `multiprocessing/context.py` writes
      `class BaseContext: def Pipe(self): from .connection import Pipe`, where
      the method's own name would otherwise hide the import two lines below it.
    """
    bound: Set[str] = set()
    imported: Set[str] = set()

    class Binder(ast.NodeVisitor):
        def visit_FunctionDef(self, n: ast.FunctionDef) -> None:
            bound.add(n.name)
            self._type_params(n)
            self.generic_visit(n)

        def visit_AsyncFunctionDef(self, n: ast.AsyncFunctionDef) -> None:
            bound.add(n.name)
            self._type_params(n)
            self.generic_visit(n)

        def visit_ClassDef(self, n: ast.ClassDef) -> None:
            bound.add(n.name)
            self._type_params(n)
            self.generic_visit(n)

        def visit_arg(self, n: ast.arg) -> None:
            # Every parameter kind is an `arg` node: positional, keyword-only,
            # `*args` and `**kwargs` alike.
            bound.add(n.arg)
            self.generic_visit(n)

        def visit_Name(self, n: ast.Name) -> None:
            # Assignment targets, augmented assignment, tuple unpacking, `for`
            # and comprehension targets, `with ... as`, and the walrus all
            # store through a `Name` in a `Store` context.
            if isinstance(n.ctx, (ast.Store, ast.Del)):
                bound.add(n.id)

        def visit_ExceptHandler(self, n: ast.ExceptHandler) -> None:
            # `except E as e` carries the name as a plain string, not a node.
            if n.name:
                bound.add(n.name)
            self.generic_visit(n)

        def visit_Global(self, n: ast.Global) -> None:
            # `global path` names something bound at module level in this file.
            # If step 1 cannot resolve it, the name is not this file's to give
            # to a symbol somewhere else.
            bound.update(n.names)

        def visit_Nonlocal(self, n: ast.Nonlocal) -> None:
            bound.update(n.names)

        def visit_MatchAs(self, n: ast.MatchAs) -> None:
            if n.name:
                bound.add(n.name)
            self.generic_visit(n)

        def visit_MatchStar(self, n: ast.MatchStar) -> None:
            if n.name:
                bound.add(n.name)

        def visit_MatchMapping(self, n: ast.MatchMapping) -> None:
            if n.rest:
                bound.add(n.rest)
            self.generic_visit(n)

        def visit_alias(self, n: ast.alias) -> None:
            imported.add((n.asname or n.name).split(".")[0])

        def _type_params(self, n: ast.AST) -> None:
            # PEP 695 — `def f[T](x: T)` binds T for the signature. Read by
            # attribute so this file still runs where the node does not exist.
            for tp in getattr(n, "type_params", []) or []:
                name = getattr(tp, "name", None)
                if isinstance(name, str):
                    bound.add(name)

    Binder().visit(tree)
    return bound - set(info.local_symbols) - set(info.import_bindings) - imported


def _referenced_names(
    node: ast.AST, bound: Optional[Set[str]] = None
) -> Tuple[Set[object], Set[object]]:
    """Split referenced names by position.

    Each element is either a bare name (``"APIRouter"``) or a
    ``(module_alias, attribute)`` pair (``("routing", "APIRouter")``).

    Returns ``(used, annotated)``:

    * ``used`` — names appearing anywhere executable: call targets, ``isinstance``
      arguments, default values, decorators, base-class lists.
    * ``annotated`` — names appearing *only* inside type annotations (parameter
      annotations, return annotations, ``x: T`` targets), including string
      forward references.

    A name used in both positions counts as used: annotating something you also
    call is still a real dependency. The split lets callers distinguish "I build
    or call this" from "I merely hold a reference typed as this", which is what
    separates a genuine dependency from a back-reference.

    ``bound`` is the set of names the file binds itself — see
    ``_module_bound_names``. A bare name in it is dropped: it denotes that
    binding, and offering it as a reference would make a loop variable a
    dependency on another package. ``(alias, attribute)`` pairs are left alone,
    since those resolve through the alias's import binding and do not reach the
    unique-name step at all.
    """
    used: Set[object] = set()
    annotated: Set[object] = set()

    class Visitor(ast.NodeVisitor):
        def __init__(self) -> None:
            self.annotation_depth = 0

        def _bucket(self) -> Set[object]:
            return annotated if self.annotation_depth else used

        def _visit_annotation(self, n: Optional[ast.AST]) -> None:
            if n is None:
                return
            self.annotation_depth += 1
            self.visit(n)
            self.annotation_depth -= 1

        def visit_Name(self, n: ast.Name) -> None:
            self._bucket().add(n.id)

        def visit_Attribute(self, n: ast.Attribute) -> None:
            # `routing.APIRouter` is recorded as the pair ("routing", "APIRouter")
            # so it can be resolved through the module `routing` is bound to.
            # Children are still visited, so the bare base name is recorded too.
            if isinstance(n.value, ast.Name):
                self._bucket().add((n.value.id, n.attr))
            self.generic_visit(n)

        def visit_Constant(self, n: ast.Constant) -> None:
            # A string is a reference only where a type is expected.
            #
            # `def f(x: "Foo")` names a class and `{"media": obj.media}` names a
            # dict key; the difference is where the string sits, not what it
            # spells. Without the position, every identifier-shaped string
            # would count: `if name != "ByteString"`,
            # `if sectName in {"temp", "cdata", "ignore"}` and
            # `getattr(candidate, "default", True)` would all become
            # dependencies.
            #
            # `annotation_depth` is what the visitor keeps for exactly this
            # question, and `_bucket` reads it two lines down as well.
            #
            # What it gives up: a forward reference written outside an
            # annotation, `cast("Foo", x)` and `TypeVar("T", bound="Foo")`.
            # Measured rather than assumed — of the 745 edges the position check
            # removes across Django and CPython, the number arising from such a
            # call is zero. CPython holds 230 `TypeVar` and 65 `cast` string
            # arguments and every one of them resolves through the module's own
            # symbols or its imports, before uniqueness is ever consulted.
            if (
                self.annotation_depth
                and isinstance(n.value, str)
                and n.value.isidentifier()
            ):
                self._bucket().add(n.value)

        def visit_AnnAssign(self, n: ast.AnnAssign) -> None:
            self._visit_annotation(n.annotation)
            if n.value is not None:
                self.visit(n.value)

        def visit_arg(self, n: ast.arg) -> None:
            self._visit_annotation(n.annotation)

        def visit_FunctionDef(self, n: ast.FunctionDef) -> None:
            self._visit_function(n)

        def visit_AsyncFunctionDef(self, n: ast.AsyncFunctionDef) -> None:
            self._visit_function(n)

        def _visit_function(self, n: ast.AST) -> None:
            for dec in getattr(n, "decorator_list", []):
                self.visit(dec)
            self.visit(getattr(n, "args"))
            self._visit_annotation(getattr(n, "returns", None))
            for stmt in getattr(n, "body", []):
                self.visit(stmt)

    Visitor().visit(node)
    if bound:
        used = {r for r in used if not (isinstance(r, str) and r in bound)}
        annotated = {r for r in annotated if not (isinstance(r, str) and r in bound)}
    return used, annotated - used


def main(argv: List[str]) -> int:
    if len(argv) < 2:
        print("Usage: analyze_symbols.py <root> [<root>...]", file=sys.stderr)
        return 2
    roots = argv[1:]
    result = analyze(roots)
    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
