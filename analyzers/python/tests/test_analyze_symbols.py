"""Unit tests for Planisphere Python symbol analyzer."""

from __future__ import annotations

import os
import tempfile
import textwrap
import unittest

from analyze_symbols import analyze

class AnalyzerTests(unittest.TestCase):
    # The source these two read is written here rather than kept on disk: a
    # fixture directory would be the one tracked input that can drift away from
    # what the analyzer produces. Written here, the input to each assertion is
    # visible beside it, as in every other test in this file.
    SAMPLE = """
        class User:
            pass


        class Repo:
            def save(self) -> None:
                pass


        class Admin(User):
            def __init__(self, repo: Repo) -> None:
                self.repo = repo

            def run(self) -> None:
                self.repo.save()


        def helper(repo: Repo) -> Repo:
            return repo


        class Service:
            '''Body-position reference: builds a Repo and checks its type.'''

            repo: Repo

            def __init__(self) -> None:
                self.repo = Repo()

            def is_repo(self, candidate: User) -> bool:
                return isinstance(candidate, Repo)
        """

    def test_inheritance_uses_and_references(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "models.py"), self.SAMPLE)
            self._write(os.path.join(tmp, "constants.py"), "ANSWER = 42\n")
            result = analyze([tmp])
        kinds = {(n["name"], n["kind"]) for n in result["nodes"]}
        self.assertIn(("User", "class"), kinds)
        self.assertIn(("Admin", "class"), kinds)
        self.assertIn(("Repo", "class"), kinds)
        self.assertIn(("Service", "class"), kinds)
        self.assertIn(("helper", "function"), kinds)

        edges = {(e["from"], e["to"], e["kind"]) for e in result["edges"]}
        by_name = {n["name"]: n["id"] for n in result["nodes"]}
        admin, user, repo = by_name["Admin"], by_name["User"], by_name["Repo"]
        service, helper = by_name["Service"], by_name["helper"]

        self.assertIn((admin, user, "inherits"), edges)

        # Annotation-only mentions are references, not uses: Admin names Repo
        # solely in `def __init__(self, repo: Repo)`.
        self.assertIn((admin, repo, "references"), edges)
        self.assertNotIn((admin, repo, "uses"), edges)
        self.assertIn((helper, repo, "references"), edges)
        self.assertNotIn((helper, repo, "uses"), edges)

        # A body-position mention is a use, and it wins over the annotation:
        # Service both declares `repo: Repo` and calls `Repo()`.
        self.assertIn((service, repo, "uses"), edges)
        self.assertNotIn((service, repo, "references"), edges)
        # ...while a name it only annotates stays a reference.
        self.assertIn((service, user, "references"), edges)

        # methods are not nodes
        self.assertFalse(any(n["name"] == "save" for n in result["nodes"]))

    def test_file_fallback(self) -> None:
        """Symbol-less modules (except noise names) become file nodes."""
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "models.py"), self.SAMPLE)
            self._write(os.path.join(tmp, "constants.py"), "ANSWER = 42\n")
            result = analyze([tmp])
        file_nodes = [n for n in result["nodes"] if n["kind"] == "file"]
        self.assertEqual(len(file_nodes), 1)
        self.assertTrue(file_nodes[0]["file"].endswith("constants.py"))

    @staticmethod
    def _write(path: str, text: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(textwrap.dedent(text))

    def test_module_attribute_reference_resolves(self) -> None:
        """`from pkg import mod` then `mod.Symbol(...)` is a real use."""
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "pkg", "__init__.py"), "")
            self._write(
                os.path.join(tmp, "pkg", "routing.py"), "class Router:\n    pass\n"
            )
            self._write(
                os.path.join(tmp, "pkg", "app.py"),
                """
                from pkg import routing


                class App:
                    def __init__(self) -> None:
                        self.router = routing.Router()
                """,
            )
            result = analyze([tmp])
        edges = {(e["from"], e["to"], e["kind"]) for e in result["edges"]}
        by_name = {n["name"]: n["id"] for n in result["nodes"]}
        self.assertIn((by_name["App"], by_name["Router"], "uses"), edges)

    def test_bare_module_import_attribute_resolves(self) -> None:
        """`import pkg.routing as routing` then `routing.Router` also resolves."""
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "pkg", "__init__.py"), "")
            self._write(
                os.path.join(tmp, "pkg", "routing.py"), "class Router:\n    pass\n"
            )
            self._write(
                os.path.join(tmp, "pkg", "app.py"),
                """
                import pkg.routing as routing


                class App:
                    def build(self) -> None:
                        routing.Router()
                """,
            )
            result = analyze([tmp])
        edges = {(e["from"], e["to"], e["kind"]) for e in result["edges"]}
        by_name = {n["name"]: n["id"] for n in result["nodes"]}
        self.assertIn((by_name["App"], by_name["Router"], "uses"), edges)

    def test_external_import_does_not_attach_to_same_named_symbol(self) -> None:
        """An imported external name must not link to a project class of that name."""
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "pkg", "__init__.py"), "")
            self._write(
                os.path.join(tmp, "pkg", "schema.py"),
                "class Response:\n    pass\n",
            )
            self._write(
                os.path.join(tmp, "pkg", "web.py"),
                """
                from starlette.responses import Response


                class Handler:
                    def send(self) -> None:
                        Response()
                """,
            )
            result = analyze([tmp])
        by_name = {n["name"]: n["id"] for n in result["nodes"]}
        offending = [
            e
            for e in result["edges"]
            if e["from"] == by_name["Handler"] and e["to"] == by_name["Response"]
        ]
        self.assertEqual(offending, [])

    def test_module_name_is_not_matched_as_a_filename_suffix(self) -> None:
        """`import time` must not resolve to `_pydatetime.py`.

        The resolver compares path components, not characters. In CPython's Lib
        there is no `time.py` — `time` is a C module — so a fallback to
        `path.endswith(rel + ".py")` would land every `import time` on
        `_pydatetime.py`, whose name happens to end in those seven characters:
        75 edges in that one project, all confidently wrong.
        """
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "pkg", "__init__.py"), "")
            self._write(
                os.path.join(tmp, "pkg", "_pydatetime.py"),
                "class time:\n    pass\n",
            )
            self._write(
                os.path.join(tmp, "pkg", "user.py"),
                """
                import time


                class Waiter:
                    def wait(self) -> None:
                        time.time()
                """,
            )
            result = analyze([tmp])
        by_name = {n["name"]: n["id"] for n in result["nodes"]}
        offending = [
            e
            for e in result["edges"]
            if e["from"] == by_name["Waiter"] and e["to"] == by_name["time"]
        ]
        self.assertEqual(offending, [])

    def test_nested_module_path_still_resolves(self) -> None:
        """The index must still find a module several directories down."""
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "src", "pkg", "__init__.py"), "")
            self._write(os.path.join(tmp, "src", "pkg", "sub", "__init__.py"), "")
            self._write(
                os.path.join(tmp, "src", "pkg", "sub", "thing.py"),
                "class Thing:\n    pass\n",
            )
            self._write(
                os.path.join(tmp, "src", "pkg", "user.py"),
                """
                from pkg.sub.thing import Thing


                class Holder:
                    def make(self) -> Thing:
                        return Thing()
                """,
            )
            result = analyze([tmp])
        by_name = {n["name"]: n["id"] for n in result["nodes"]}
        edges = {(e["from"], e["to"]) for e in result["edges"]}
        self.assertIn((by_name["Holder"], by_name["Thing"]), edges)

    def test_package_resolves_through_its_init(self) -> None:
        """A package is named by its directory, and its `__init__` answers."""
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "src", "pkg", "__init__.py"), "")
            self._write(
                os.path.join(tmp, "src", "pkg", "sub", "__init__.py"),
                "class Exported:\n    pass\n",
            )
            self._write(
                os.path.join(tmp, "src", "pkg", "user.py"),
                """
                from pkg.sub import Exported


                class Holder:
                    def make(self) -> Exported:
                        return Exported()
                """,
            )
            result = analyze([tmp])
        by_name = {n["name"]: n["id"] for n in result["nodes"]}
        edges = {(e["from"], e["to"]) for e in result["edges"]}
        self.assertIn((by_name["Holder"], by_name["Exported"]), edges)

    def test_type_checking_import_resolves(self) -> None:
        """Imports guarded by `if TYPE_CHECKING:` still bind the name."""
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "pkg", "__init__.py"), "")
            self._write(
                os.path.join(tmp, "pkg", "routing.py"), "class Route:\n    pass\n"
            )
            self._write(
                os.path.join(tmp, "pkg", "utils.py"),
                """
                from typing import TYPE_CHECKING

                if TYPE_CHECKING:
                    from pkg.routing import Route


                def describe(route: "Route") -> str:
                    return str(route)
                """,
            )
            result = analyze([tmp])
        edges = {(e["from"], e["to"], e["kind"]) for e in result["edges"]}
        by_name = {n["name"]: n["id"] for n in result["nodes"]}
        self.assertIn((by_name["describe"], by_name["Route"], "references"), edges)

    def test_relative_import_resolves_within_own_package(self) -> None:
        """`from .helpers import H` must not match another package's helpers.py."""
        with tempfile.TemporaryDirectory() as tmp:
            for pkg, cls in (("a", "HelperA"), ("b", "HelperB")):
                self._write(os.path.join(tmp, pkg, "__init__.py"), "")
                self._write(
                    os.path.join(tmp, pkg, "helpers.py"), f"class {cls}:\n    pass\n"
                )
            self._write(
                os.path.join(tmp, "a", "main.py"),
                """
                from .helpers import HelperA


                class Runner:
                    def go(self) -> None:
                        HelperA()
                """,
            )
            result = analyze([tmp])
        edges = {(e["from"], e["to"]) for e in result["edges"]}
        by_name = {n["name"]: n["id"] for n in result["nodes"]}
        self.assertIn((by_name["Runner"], by_name["HelperA"]), edges)
        self.assertNotIn((by_name["Runner"], by_name["HelperB"]), edges)

    def test_docs_and_noise_file_nodes_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "pkg")
            docs = os.path.join(tmp, "docs")
            examples = os.path.join(tmp, "examples")
            os.makedirs(lib)
            os.makedirs(docs)
            os.makedirs(examples)
            with open(os.path.join(lib, "__init__.py"), "w", encoding="utf-8") as f:
                f.write("# re-exports only\n")
            with open(os.path.join(lib, "version.py"), "w", encoding="utf-8") as f:
                f.write('__version__ = "1.0"\n')
            with open(os.path.join(lib, "core.py"), "w", encoding="utf-8") as f:
                f.write("class Core:\n    pass\n")
            with open(os.path.join(lib, "empty_mod.py"), "w", encoding="utf-8") as f:
                f.write("# no symbols\n")
            with open(os.path.join(docs, "conf.py"), "w", encoding="utf-8") as f:
                f.write("project = 'x'\n")
            with open(os.path.join(examples, "demo.py"), "w", encoding="utf-8") as f:
                f.write("def demo():\n    pass\n")
            result = analyze([tmp])
        names = {(n["name"], n["kind"]) for n in result["nodes"]}
        self.assertEqual(
            names,
            {("Core", "class"), ("empty_mod.py", "file")},
        )
        self.assertNotIn(("__init__.py", "file"), names)
        self.assertNotIn(("version.py", "file"), names)
        self.assertNotIn(("demo", "function"), names)

    def test_empty_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = analyze([tmp])
        self.assertEqual(result["nodes"], [])
        self.assertEqual(result["edges"], [])

    def test_non_python_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "readme.md"), "w", encoding="utf-8") as f:
                f.write("# hi\n")
            result = analyze([tmp])
        self.assertEqual(result["nodes"], [])

    def test_test_modules_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "lib")
            tests = os.path.join(tmp, "tests")
            os.makedirs(lib)
            os.makedirs(tests)
            with open(os.path.join(lib, "app.py"), "w", encoding="utf-8") as f:
                f.write("class App:\n    pass\n")
            with open(os.path.join(tests, "test_app.py"), "w", encoding="utf-8") as f:
                f.write("def test_ok():\n    pass\n")
            with open(os.path.join(lib, "test_helper.py"), "w", encoding="utf-8") as f:
                f.write("def test_in_lib():\n    pass\n")
            with open(os.path.join(lib, "conftest.py"), "w", encoding="utf-8") as f:
                f.write("def pytest_configure():\n    pass\n")
            result = analyze([tmp])
        names = {(n["name"], n["kind"]) for n in result["nodes"]}
        self.assertIn(("App", "class"), names)
        self.assertNotIn(("test_ok", "function"), names)
        self.assertNotIn(("test_in_lib", "function"), names)
        self.assertNotIn(("pytest_configure", "function"), names)

    def test_builtin_name_not_linked_via_unique_global(self) -> None:
        """`isinstance(x, set)` must not use a project function named `set`."""
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "ops.py"), "w", encoding="utf-8") as f:
                f.write("def set(field, value):\n    pass\n")
            with open(os.path.join(tmp, "util.py"), "w", encoding="utf-8") as f:
                f.write(
                    "def freeze(obj):\n"
                    "    if isinstance(obj, set):\n"
                    "        return frozenset(obj)\n"
                    "    return obj\n"
                )
            result = analyze([tmp])
        edges = {(e["from"], e["to"], e["kind"]) for e in result["edges"]}
        freeze = next(n["id"] for n in result["nodes"] if n["name"] == "freeze")
        set_fn = next(n["id"] for n in result["nodes"] if n["name"] == "set")
        self.assertNotIn((freeze, set_fn, "uses"), edges)

    def test_no_uses_when_inherits_same_pair(self) -> None:
        """Subclass body naming its base must not add a parallel uses edge."""
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "m.py"), "w", encoding="utf-8") as f:
                f.write(
                    "class Base:\n"
                    "    pass\n"
                    "\n"
                    "class Child(Base):\n"
                    "    def run(self) -> Base:\n"
                    "        return Base()\n"
                )
            result = analyze([tmp])
        edges = {(e["from"], e["to"], e["kind"]) for e in result["edges"]}
        child = next(n["id"] for n in result["nodes"] if n["name"] == "Child")
        base = next(n["id"] for n in result["nodes"] if n["name"] == "Base")
        self.assertIn((child, base, "inherits"), edges)
        self.assertNotIn((child, base, "uses"), edges)

    # --- re-exports through a package's __init__ --------------------------
    #
    # Written as source rather than as an assertion about a fixture graph.
    # FastAPI gains nothing from this rule and TinyDB gains nothing, so a test
    # phrased against either of them would pass on an analyzer that does not
    # follow re-exports.
    #
    # Every tree below plants a decoy: a second class of the same name, in an
    # unrelated module. Without it these tests would pass on such an analyzer,
    # because a name that is unique across the project is resolved by the
    # unique-global-name guess whether or not anything followed the re-export.
    # That is exactly why Django's `Migration` needs the follow and a toy
    # example does not: there are twenty-five of them, so the guess cannot
    # fire and the follow is all that is left. The decoy reproduces that condition,
    # and it doubles as the assertion that the follow lands on the right one.

    DECOY = "class {name}:\n    pass\n"

    def _decoy(self, tmp: str, name: str) -> None:
        """Same-named classes elsewhere, so the unique-name guess cannot fire.

        Two of them, not one. The guess fires when a name has exactly one
        definition project-wide, so a single decoy in a tree that otherwise
        defines the name nowhere *enables* it rather than disabling it, and the
        cycle test would fail for the wrong reason.
        """
        for i in (1, 2):
            self._write(
                os.path.join(tmp, f"decoy{i}.py"), self.DECOY.format(name=name)
            )

    def _reexport_tree(self, tmp: str) -> None:
        """`pkg/__init__.py` re-exports `Base`, which `core.py` defines."""
        self._write(os.path.join(tmp, "a", "__init__.py"), "")
        self._write(os.path.join(tmp, "a", "b", "__init__.py"), "")
        self._write(
            os.path.join(tmp, "a", "b", "pkg", "__init__.py"),
            "from .core import Base\n",
        )
        self._write(
            os.path.join(tmp, "a", "b", "pkg", "core.py"),
            "class Base:\n    pass\n",
        )
        self._decoy(tmp, "Base")

    def test_class_inherits_through_a_package_re_export(self) -> None:
        """`class X(pkg.Base)` where `pkg` re-exports `Base` from elsewhere.

        This is how every Django migration is written — `from django.db import
        migrations` then `class Migration(migrations.Migration)` — all 24 in
        that project. The package resolves to its `__init__.py`, `Base` is not
        among the symbols that file *defines*, and a lookup that stops there
        instead of following the re-export it does state resolves none of them.
        """
        with tempfile.TemporaryDirectory() as tmp:
            self._reexport_tree(tmp)
            self._write(
                os.path.join(tmp, "user.py"),
                """
                from a.b import pkg


                class X(pkg.Base):
                    pass
                """,
            )
            result = analyze([tmp])
        by_id = {n["id"]: n for n in result["nodes"]}
        edges = {
            (by_id[e["from"]]["name"], by_id[e["to"]]["name"], e["kind"])
            for e in result["edges"]
            if e["from"] in by_id and e["to"] in by_id
        }
        self.assertIn(("X", "Base", "inherits"), edges)
        target = [
            by_id[e["to"]]["file"]
            for e in result["edges"]
            if e["kind"] == "inherits" and by_id.get(e["from"], {}).get("name") == "X"
        ]
        self.assertTrue(
            target and target[0].endswith(os.path.join("pkg", "core.py")),
            f"should point to core.py, which defines Base, got {target}",
        )

    def test_use_through_a_package_re_export(self) -> None:
        """The same lookup answers `pkg.Helper()`, not only inheritance."""
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "a", "__init__.py"), "")
            self._write(
                os.path.join(tmp, "a", "pkg", "__init__.py"),
                "from .core import Helper\n",
            )
            self._write(
                os.path.join(tmp, "a", "pkg", "core.py"),
                "class Helper:\n    pass\n",
            )
            self._decoy(tmp, "Helper")
            self._write(
                os.path.join(tmp, "user.py"),
                """
                from a import pkg


                class Caller:
                    def go(self) -> None:
                        pkg.Helper()
                """,
            )
            result = analyze([tmp])
        by_id = {n["id"]: n for n in result["nodes"]}
        edges = {
            (by_id[e["from"]]["name"], by_id[e["to"]]["name"], e["kind"])
            for e in result["edges"]
            if e["from"] in by_id and e["to"] in by_id
        }
        self.assertIn(("Caller", "Helper", "uses"), edges)

    def test_re_export_of_a_re_export(self) -> None:
        """Following is transitive: outer -> inner -> the definition."""
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "a", "__init__.py"), "")
            self._write(
                os.path.join(tmp, "a", "outer", "__init__.py"),
                "from .inner import Deep\n",
            )
            self._write(
                os.path.join(tmp, "a", "outer", "inner", "__init__.py"),
                "from .deep import Deep\n",
            )
            self._write(
                os.path.join(tmp, "a", "outer", "inner", "deep.py"),
                "class Deep:\n    pass\n",
            )
            self._decoy(tmp, "Deep")
            self._write(
                os.path.join(tmp, "user.py"),
                """
                from a import outer


                class X(outer.Deep):
                    pass
                """,
            )
            result = analyze([tmp])
        by_id = {n["id"]: n for n in result["nodes"]}
        hit = [
            by_id[e["to"]]["file"]
            for e in result["edges"]
            if e["kind"] == "inherits" and by_id.get(e["from"], {}).get("name") == "X"
        ]
        self.assertTrue(
            hit and hit[0].endswith("deep.py"),
            f"should be followed all the way to deep.py, got {hit}",
        )

    def test_a_cycle_of_re_exports_terminates(self) -> None:
        """Two modules re-exporting from each other must not loop.

        The stop condition is "this module again", not a hop count: a cycle is
        the reason to stop, and no depth is obviously too deep.
        """
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "a", "__init__.py"), "")
            self._write(
                os.path.join(tmp, "a", "one", "__init__.py"),
                "from ..two import Ghost\n",
            )
            self._write(
                os.path.join(tmp, "a", "two", "__init__.py"),
                "from ..one import Ghost\n",
            )
            self._decoy(tmp, "Ghost")
            self._write(
                os.path.join(tmp, "user.py"),
                """
                from a import one


                class X(one.Ghost):
                    pass
                """,
            )
            result = analyze([tmp])
        by_id = {n["id"]: n for n in result["nodes"]}
        inherits = [
            e for e in result["edges"]
            if e["kind"] == "inherits" and by_id.get(e["from"], {}).get("name") == "X"
        ]
        self.assertEqual(inherits, [])

    def test_a_re_export_leading_outside_the_project_stays_external(self) -> None:
        """A name re-exported from outside is external, not a lookalike."""
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "a", "__init__.py"), "")
            self._write(
                os.path.join(tmp, "a", "pkg", "__init__.py"),
                "from thirdparty.lib import Base\n",
            )
            # Two same-named classes elsewhere, so neither the guess nor the
            # follow has anywhere legitimate to land: the binding names a
            # module this project does not contain, and that is the end of it.
            self._write(
                os.path.join(tmp, "a", "unrelated.py"),
                "class Base:\n    pass\n",
            )
            self._decoy(tmp, "Base")
            self._write(
                os.path.join(tmp, "user.py"),
                """
                from a import pkg


                class X(pkg.Base):
                    pass
                """,
            )
            result = analyze([tmp])
        by_id = {n["id"]: n for n in result["nodes"]}
        inherits = [
            e for e in result["edges"]
            if e["kind"] == "inherits" and by_id.get(e["from"], {}).get("name") == "X"
        ]
        self.assertEqual(
            inherits,
            [],
            "following should stop once it leaves the project, not fall back to guessing a same-named one",
        )

    def test_a_star_import_is_not_followed(self) -> None:
        """`from .other import *` binds by rules the source does not state."""
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "a", "__init__.py"), "")
            self._write(
                os.path.join(tmp, "a", "pkg", "__init__.py"),
                "from .other import *\n",
            )
            self._write(
                os.path.join(tmp, "a", "pkg", "other.py"),
                "class Starred:\n    pass\n",
            )
            self._decoy(tmp, "Starred")
            self._write(
                os.path.join(tmp, "user.py"),
                """
                from a import pkg


                class X(pkg.Starred):
                    pass
                """,
            )
            result = analyze([tmp])
        by_id = {n["id"]: n for n in result["nodes"]}
        inherits = [
            e for e in result["edges"]
            if e["kind"] == "inherits" and by_id.get(e["from"], {}).get("name") == "X"
        ]
        self.assertEqual(inherits, [])

    def test_a_defined_name_is_unaffected_by_re_exports(self) -> None:
        """What already resolved must still resolve, to the same symbol."""
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "a", "__init__.py"), "")
            self._write(
                os.path.join(tmp, "a", "pkg", "__init__.py"),
                "from .core import Other\n\n\nclass Base:\n    pass\n",
            )
            self._write(
                os.path.join(tmp, "a", "pkg", "core.py"),
                "class Other:\n    pass\n",
            )
            self._decoy(tmp, "Base")
            self._write(
                os.path.join(tmp, "user.py"),
                """
                from a import pkg


                class X(pkg.Base):
                    pass
                """,
            )
            result = analyze([tmp])
        by_id = {n["id"]: n for n in result["nodes"]}
        hit = [
            by_id[e["to"]]["file"]
            for e in result["edges"]
            if e["kind"] == "inherits" and by_id.get(e["from"], {}).get("name") == "X"
        ]
        self.assertTrue(
            hit and hit[0].endswith(os.path.join("pkg", "__init__.py")),
            f"Base is defined by __init__.py itself and should point to it, got {hit}",
        )


if __name__ == "__main__":
    unittest.main()


class LocalBindingTests(unittest.TestCase):
    """A name the file binds itself is not a reference to something elsewhere.

    Each case below binds one name and then uses it. The project's only other
    module-level `handle` is in `other.py`, which is the condition the
    unique-global step needs: with exactly one candidate it takes it. That is
    how `_ComplexBinder`, whose `__create_handler` loops `for f in l`, would
    come to depend on `turtledemo/chaos.py`, which defines the project's only `f`.

    The forms are enumerated rather than sampled because a walk that misses one
    leaves the false edge, and a walk that claims something that is not a
    binding drops a real one. Neither shows up on the fixtures the project
    looks at most: FastAPI produces none of these edges at all.
    """

    OTHER = "def handle():\n    return 1\n"

    @staticmethod
    def _write(path: str, text: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(textwrap.dedent(text))

    def _edges(self, caller_src: str) -> set:
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "caller.py"), caller_src)
            self._write(os.path.join(tmp, "other.py"), self.OTHER)
            result = analyze([tmp])
        by_id = {n["id"]: n for n in result["nodes"]}
        return {
            (by_id[e["from"]]["name"], by_id[e["to"]]["name"], e["kind"])
            for e in result["edges"]
        }

    def assertNoHandleEdge(self, caller_src: str, form: str) -> None:
        edges = self._edges(caller_src)
        stray = {e for e in edges if e[1] == "handle"}
        self.assertEqual(stray, set(), f"a name bound by {form} should not link to another file's handle")

    # --- the binding forms ------------------------------------------------

    def test_for_target(self) -> None:
        self.assertNoHandleEdge(
            """
            class Caller:
                def go(self, items):
                    for handle in items:
                        handle()
            """,
            "for target",
        )

    def test_parameter(self) -> None:
        self.assertNoHandleEdge(
            """
            class Caller:
                def go(self, handle):
                    handle()
            """,
            "parameter",
        )

    def test_keyword_only_parameter(self) -> None:
        self.assertNoHandleEdge(
            """
            class Caller:
                def go(self, *, handle=None):
                    handle()
            """,
            "keyword-only parameter",
        )

    def test_star_args(self) -> None:
        self.assertNoHandleEdge(
            """
            class Caller:
                def go(self, *handle):
                    return handle[0]
            """,
            "*args",
        )

    def test_double_star_kwargs(self) -> None:
        self.assertNoHandleEdge(
            """
            class Caller:
                def go(self, **handle):
                    return handle
            """,
            "**kwargs",
        )

    def test_assignment(self) -> None:
        self.assertNoHandleEdge(
            """
            class Caller:
                def go(self):
                    handle = 1
                    return handle
            """,
            "assignment",
        )

    def test_tuple_unpacking(self) -> None:
        self.assertNoHandleEdge(
            """
            class Caller:
                def go(self, pair):
                    handle, rest = pair
                    return handle
            """,
            "tuple unpacking",
        )

    def test_comprehension_target(self) -> None:
        self.assertNoHandleEdge(
            """
            class Caller:
                def go(self, items):
                    return [handle for handle in items]
            """,
            "comprehension target",
        )

    def test_with_as(self) -> None:
        self.assertNoHandleEdge(
            """
            class Caller:
                def go(self, ctx):
                    with ctx as handle:
                        return handle
            """,
            "with ... as",
        )

    def test_except_as(self) -> None:
        self.assertNoHandleEdge(
            """
            class Caller:
                def go(self):
                    try:
                        pass
                    except ValueError as handle:
                        return handle
            """,
            "except ... as",
        )

    def test_walrus(self) -> None:
        self.assertNoHandleEdge(
            """
            class Caller:
                def go(self, items):
                    if (handle := items[0]):
                        return handle
                    return None
            """,
            "walrus",
        )

    def test_nested_def(self) -> None:
        self.assertNoHandleEdge(
            """
            class Caller:
                def go(self):
                    def handle():
                        return 1
                    return handle()
            """,
            "nested def",
        )

    def test_nested_class(self) -> None:
        self.assertNoHandleEdge(
            """
            class Caller:
                def go(self):
                    class handle:
                        pass
                    return handle()
            """,
            "nested class",
        )

    def test_global_declaration(self) -> None:
        self.assertNoHandleEdge(
            """
            class Caller:
                def go(self):
                    global handle
                    return handle
            """,
            "global",
        )

    def test_nonlocal_declaration(self) -> None:
        self.assertNoHandleEdge(
            """
            class Caller:
                def go(self):
                    def inner():
                        nonlocal handle
                        return handle
                    return inner
            """,
            "nonlocal",
        )

    def test_module_level_assignment(self) -> None:
        # Not a `def` or `class`, so it is not in `local_symbols` and step 1
        # cannot answer it — but the file still binds the name, and what the
        # name means here is this value.
        self.assertNoHandleEdge(
            """
            handle = 1


            class Caller:
                def go(self):
                    return handle
            """,
            "module-level assignment",
        )

    def test_match_capture(self) -> None:
        self.assertNoHandleEdge(
            """
            class Caller:
                def go(self, value):
                    match value:
                        case [handle]:
                            return handle
                    return None
            """,
            "match capture",
        )

    # --- what must keep working -------------------------------------------

    def test_a_name_the_file_does_not_bind_still_resolves(self) -> None:
        # The complement, in the same shape. This is where the unique-global
        # step's 291 real edges come from — `turtle.py` writes
        # `import tkinter as TK` and the alias defeats the import step.
        edges = self._edges(
            """
            class Caller:
                def go(self):
                    return handle()
            """
        )
        self.assertIn(("Caller", "handle", "uses"), edges)

    def test_binding_one_name_does_not_hide_another(self) -> None:
        edges = self._edges(
            """
            class Caller:
                def go(self, items):
                    for other in items:
                        other()
                    return handle()
            """
        )
        self.assertIn(("Caller", "handle", "uses"), edges)

    def test_same_module_symbols_still_resolve(self) -> None:
        # A class defined here is a binding by any reading, and step 1 answers
        # it. Filtering it would delete every edge inside a file.
        edges = self._edges(
            """
            class Target:
                pass


            class Caller:
                def go(self):
                    return Target()
            """
        )
        self.assertIn(("Caller", "Target", "uses"), edges)

    def test_a_local_import_beats_a_method_of_the_same_name(self) -> None:
        # `multiprocessing/context.py` writes exactly this: the method is named
        # `Pipe` and imports `Pipe` two lines below. The method name binds in
        # the class body, not inside its own body, and the reference is to the
        # import. Thirteen edges across Django and CPython are of this shape.
        with tempfile.TemporaryDirectory() as tmp:
            self._write(
                os.path.join(tmp, "caller.py"),
                """
                class Caller:
                    def handle(self):
                        from other import handle
                        return handle()
                """,
            )
            self._write(os.path.join(tmp, "other.py"), self.OTHER)
            result = analyze([tmp])
        by_id = {n["id"]: n for n in result["nodes"]}
        edges = {
            (by_id[e["from"]]["name"], by_id[e["to"]]["name"], e["kind"])
            for e in result["edges"]
        }
        self.assertIn(("Caller", "handle", "uses"), edges)

    def test_a_local_import_beats_a_global_declaration(self) -> None:
        # `unittest/__init__.py`'s lazy `__getattr__`: `global X` then
        # `from .async_case import X`.
        with tempfile.TemporaryDirectory() as tmp:
            self._write(
                os.path.join(tmp, "caller.py"),
                """
                class Caller:
                    def go(self, name):
                        global handle
                        from other import handle
                        return handle()
                """,
            )
            self._write(os.path.join(tmp, "other.py"), self.OTHER)
            result = analyze([tmp])
        by_id = {n["id"]: n for n in result["nodes"]}
        edges = {
            (by_id[e["from"]]["name"], by_id[e["to"]]["name"], e["kind"])
            for e in result["edges"]
        }
        self.assertIn(("Caller", "handle", "uses"), edges)

    def test_imported_names_still_resolve(self) -> None:
        # An import is a binding too, and excluding it would take step 2 with
        # it. What the file binds *besides* the import must not matter.
        with tempfile.TemporaryDirectory() as tmp:
            self._write(
                os.path.join(tmp, "caller.py"),
                """
                from other import handle


                class Caller:
                    def go(self, items):
                        for tmp_name in items:
                            tmp_name()
                        return handle()
                """,
            )
            self._write(os.path.join(tmp, "other.py"), self.OTHER)
            result = analyze([tmp])
        by_id = {n["id"]: n for n in result["nodes"]}
        edges = {
            (by_id[e["from"]]["name"], by_id[e["to"]]["name"], e["kind"])
            for e in result["edges"]
        }
        self.assertIn(("Caller", "handle", "uses"), edges)


class StringLiteralTests(unittest.TestCase):
    """A string literal is a reference only where a type is expected.

    `def f(x: "Foo")` names a class; `{"media": obj.media}` names a dict key.
    The difference is where the string sits, not what it spells — and the
    collector tracks that, in the `annotation_depth` it keeps for exactly this
    question.
    """

    OTHER = "class Marker:\n    pass\n"

    @staticmethod
    def _write(path: str, text: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(textwrap.dedent(text))

    def _edges(self, caller_src: str) -> set:
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "caller.py"), caller_src)
            self._write(os.path.join(tmp, "other.py"), self.OTHER)
            result = analyze([tmp])
        by_id = {n["id"]: n for n in result["nodes"]}
        return {
            (by_id[e["from"]]["name"], by_id[e["to"]]["name"], e["kind"])
            for e in result["edges"]
        }

    def assertNoMarkerEdge(self, src: str, where: str) -> None:
        stray = {e for e in self._edges(src) if e[1] == "Marker"}
        self.assertEqual(stray, set(), f"a string in {where} should not count as a reference")

    # --- where a string IS a type -----------------------------------------

    def test_string_parameter_annotation(self) -> None:
        edges = self._edges(
            """
            class Caller:
                def go(self, x: "Marker") -> None:
                    pass
            """
        )
        self.assertIn(("Caller", "Marker", "references"), edges)

    def test_string_return_annotation(self) -> None:
        edges = self._edges(
            """
            class Caller:
                def go(self) -> "Marker":
                    pass
            """
        )
        self.assertIn(("Caller", "Marker", "references"), edges)

    def test_string_variable_annotation(self) -> None:
        edges = self._edges(
            """
            class Caller:
                held: "Marker"
            """
        )
        self.assertIn(("Caller", "Marker", "references"), edges)

    def test_string_nested_in_an_annotation(self) -> None:
        # The depth is tracked, not the immediate parent. A test on the plain
        # case alone would pass on a rule that only looked one level up.
        edges = self._edges(
            """
            from typing import Optional


            class Caller:
                def go(self, x: Optional["Marker"]) -> None:
                    pass
            """
        )
        self.assertIn(("Caller", "Marker", "references"), edges)

    # --- where it is data --------------------------------------------------

    def test_dict_key(self) -> None:
        self.assertNoMarkerEdge(
            """
            class Caller:
                def go(self, obj):
                    return {"Marker": obj}
            """,
            "dict key",
        )

    def test_set_member(self) -> None:
        # `if sectName in {"temp", "cdata", "ignore", "include", "rcdata"}`
        self.assertNoMarkerEdge(
            """
            class Caller:
                def go(self, name):
                    return name in {"Marker", "other"}
            """,
            "set member",
        )

    def test_comparison(self) -> None:
        # `if name != "ByteString"`
        self.assertNoMarkerEdge(
            """
            class Caller:
                def go(self, name):
                    return name != "Marker"
            """,
            "comparison",
        )

    def test_getattr_name(self) -> None:
        # `getattr(candidate, "default", True)`
        self.assertNoMarkerEdge(
            """
            class Caller:
                def go(self, obj):
                    return getattr(obj, "Marker", None)
            """,
            "getattr's second argument",
        )

    def test_list_of_names(self) -> None:
        # The commonest context after dict keys.
        #
        # Not `__all__`: that sits at module level, and the collector only ever
        # walks a class or a top-level function, so a test written on it would
        # never reach the rule and would pass without testing anything.
        self.assertNoMarkerEdge(
            """
            class Caller:
                def go(self):
                    return ["Marker", "other"]
            """,
            "list member",
        )


class RedeclarationTests(unittest.TestCase):
    """A file may declare the same top-level name more than once.

    `@overload` makes it idiomatic, and every declaration gets the same
    identity — `<file>::<kind>::<name>` — so nothing downstream can tell them
    apart. Cytoscape drops an element whose id it already holds and the
    analyzer's own index is a mapping, so extra declarations would be counted
    in the artifact and then discarded by everything that read it.
    """

    @staticmethod
    def _write(path: str, text: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(textwrap.dedent(text))

    def _analyze(self, source: str) -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "mod.py"), source)
            return analyze([tmp])

    def test_overloaded_function_is_one_node(self) -> None:
        result = self._analyze(
            """
            from typing import overload


            @overload
            def field(default: int) -> int: ...


            @overload
            def field(default: str) -> str: ...


            def field(default):
                return default
            """
        )
        fields = [n for n in result["nodes"] if n["name"] == "field"]
        self.assertEqual(len(fields), 1)
        # The last declaration is the function; the earlier ones are signatures
        # for a type checker. A jump has to land on the body.
        self.assertEqual(fields[0]["line"], 13)
        self.assertEqual(fields[0]["endLine"], 14)

    def test_redeclared_class_is_one_node(self) -> None:
        result = self._analyze(
            """
            class Thing:
                first = 1


            class Thing:
                second = 2
            """
        )
        things = [n for n in result["nodes"] if n["name"] == "Thing"]
        self.assertEqual(len(things), 1)
        # The second `class Thing:`, which is what the name means afterwards.
        self.assertEqual(things[0]["line"], 6)
        self.assertEqual(things[0]["endLine"], 7)

    def test_every_node_id_is_unique(self) -> None:
        result = self._analyze(
            """
            from typing import overload


            @overload
            def f(x: int) -> int: ...


            def f(x):
                return x
            """
        )
        ids = [n["id"] for n in result["nodes"]]
        self.assertEqual(len(ids), len(set(ids)))


class EdgePrecedenceTests(unittest.TestCase):
    """One edge per ordered pair, whatever order the analyzer reaches it in.

    The precedence `inherits` > `uses` > `references` cannot rest on the order
    of two loops inside one call. A name declared twice is linked once per
    declaration, so the two halves of a pair can arrive from two calls — an
    overload's annotation naming a class, then the implementation calling it —
    and both edges would survive.
    """

    @staticmethod
    def _write(path: str, text: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(textwrap.dedent(text))

    def _edges(self, source: str, frm: str, to: str) -> list:
        with tempfile.TemporaryDirectory() as tmp:
            self._write(os.path.join(tmp, "mod.py"), source)
            self._write(
                os.path.join(tmp, "other.py"),
                """
                class Target:
                    pass
                """,
            )
            result = analyze([tmp])
        by_id = {n["id"]: n for n in result["nodes"]}
        return [
            e
            for e in result["edges"]
            if by_id[e["from"]]["name"] == frm and by_id[e["to"]]["name"] == to
        ]

    def test_a_later_uses_replaces_an_earlier_references(self) -> None:
        # The first declaration names Target only in an annotation, which is a
        # `references`. The second calls it, which is a `uses`. That is the
        # order a guard inside one call cannot handle.
        edges = self._edges(
            """
            from typing import overload

            from other import Target


            @overload
            def make(t: "Target") -> None: ...


            def make(t):
                return Target()
            """,
            "make",
            "Target",
        )
        self.assertEqual([e["kind"] for e in edges], ["uses"])

    def test_a_later_uses_does_not_displace_inherits(self) -> None:
        edges = self._edges(
            """
            from other import Target


            class Sub(Target):
                def build(self):
                    return Target()
            """,
            "Sub",
            "Target",
        )
        self.assertEqual([e["kind"] for e in edges], ["inherits"])


class ReExportOnlyModuleTests(unittest.TestCase):
    """A module that declares nothing and only imports is a re-export shim.

    `fastapi/requests.py` is one line — `from starlette.requests import
    HTTPConnection as HTTPConnection` — and `cElementTree.py` is a deprecated
    alias for another module. Drawing them is drawing the package's table of
    contents beside its contents. The named exclusion set cannot reach them:
    they are called `requests.py` and `cElementTree.py`.
    """

    @staticmethod
    def _write(path: str, text: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(textwrap.dedent(text))

    def _analyze(self, files: dict) -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            for rel, src in files.items():
                self._write(os.path.join(tmp, rel), src)
            return analyze([tmp])

    def test_module_of_only_imports_is_not_a_node(self) -> None:
        result = self._analyze(
            {
                "thing.py": "class Thing:\n    pass\n",
                "shim.py": "from thing import Thing as Thing\n",
            }
        )
        names = sorted(n["name"] for n in result["nodes"])
        self.assertEqual(names, ["Thing"])

    def test_module_with_a_constant_is_still_a_node(self) -> None:
        result = self._analyze({"limits.py": "LIMIT = 10\n"})
        kinds = [(n["kind"], n["name"]) for n in result["nodes"]]
        self.assertEqual(kinds, [("file", "limits.py")])

    def test_a_re_export_mixed_with_a_constant_is_content(self) -> None:
        result = self._analyze(
            {
                "thing.py": "class Thing:\n    pass\n",
                "mixed.py": "from thing import Thing\n\nVERSION = '1.0'\n",
            }
        )
        names = sorted(n["name"] for n in result["nodes"])
        self.assertEqual(names, ["Thing", "mixed.py"])

    def test_a_docstring_before_the_imports_is_still_a_shim(self) -> None:
        result = self._analyze(
            {
                "thing.py": "class Thing:\n    pass\n",
                "shim.py": '"""Deprecated alias."""\n\nfrom thing import Thing as Thing\n',
            }
        )
        names = sorted(n["name"] for n in result["nodes"])
        self.assertEqual(names, ["Thing"])
