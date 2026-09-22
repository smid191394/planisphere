//! The rules of java-symbol-graph, each against a project small enough to read
//! in the test. A project is written into a fresh directory and analyzed as the
//! CLI would analyze it; nothing here reaches Maven, Gradle or the network.
//!
//! Every test that says something is *not* in the graph first requires something
//! that *is*. An analyzer that produced nothing would otherwise pass every
//! negative rule.
//!
//! The analyzer is compiled once, in memory, and called directly; what it is
//! asked for is the document, so the tests are over the bytes a reader gets.

import javax.tools.*;
import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;
import java.util.stream.*;

public class Tests {
  static int checks = 0;
  static final List<String> failures = new ArrayList<>();
  static String suite = "";

  static void suite(String name) { suite = name; }

  static void ok(boolean cond, String what) {
    checks++;
    if (!cond) failures.add(suite + " — " + what);
  }

  static void eq(Object got, Object want, String what) {
    checks++;
    if (!Objects.equals(got, want)) failures.add(suite + " — " + what + " — expected " + want + ", got " + got);
  }

  // -- the analyzer under test ----------------------------------------------

  static Method analyzeToJson;

  static void loadAnalyzer() throws Exception {
    Path src = Paths.get("analyzers/java/Analyzer.java").toAbsolutePath();
    if (!Files.exists(src)) src = Paths.get(System.getProperty("user.dir")).resolve("Analyzer.java");
    Path out = Files.createTempDirectory("planisphere-java-tests");
    out.toFile().deleteOnExit();
    JavaCompiler c = ToolProvider.getSystemJavaCompiler();
    if (c == null) throw new IllegalStateException("this Java runtime has no compiler module");
    StandardJavaFileManager fm = c.getStandardFileManager(null, null, null);
    StringWriter err = new StringWriter();
    boolean built = c.getTask(err, fm, null, List.of("-d", out.toString()), null,
        fm.getJavaFileObjectsFromPaths(List.of(src))).call();
    if (!built) throw new IllegalStateException("the analyzer failed to compile:\n" + err);
    URLClassLoader loader = new URLClassLoader(new URL[] { out.toUri().toURL() }, Tests.class.getClassLoader());
    analyzeToJson = loader.loadClass("Analyzer").getMethod("analyzeToJson", List.class);
  }

  /** A project on disk, and the document the analyzer writes for it. */
  static final class Project {
    final Path dir;
    Project(String... filesAndSources) {
      try {
        dir = Files.createTempDirectory("planisphere-java-case");
        for (int i = 0; i < filesAndSources.length; i += 2) {
          Path p = dir.resolve(filesAndSources[i]);
          Files.createDirectories(p.getParent());
          Files.writeString(p, filesAndSources[i + 1]);
        }
      } catch (IOException e) { throw new UncheckedIOException(e); }
    }
    String path(String rel) { return dir.resolve(rel).toString(); }
    String id(String rel, String kind, String name) { return path(rel) + "::" + kind + "::" + name; }
    String json() {
      try { return (String) analyzeToJson.invoke(null, List.of(dir.toString())); }
      catch (InvocationTargetException e) { throw new RuntimeException(e.getCause()); }
      catch (Exception e) { throw new RuntimeException(e); }
    }
    Doc doc() { return new Doc(json()); }
  }

  /** The document, read back the way a consumer reads it. */
  static final class Doc {
    final String text;
    final List<Map<String, Object>> nodes = new ArrayList<>();
    final List<Map<String, Object>> edges = new ArrayList<>();
    @SuppressWarnings("unchecked")
    Doc(String text) {
      this.text = text;
      Map<String, Object> o = (Map<String, Object>) Json.parse(text);
      for (Object n : (List<Object>) o.getOrDefault("nodes", List.of())) nodes.add((Map<String, Object>) n);
      for (Object e : (List<Object>) o.getOrDefault("edges", List.of())) edges.add((Map<String, Object>) e);
    }
    Map<String, Object> node(String id) {
      return nodes.stream().filter(n -> id.equals(n.get("id"))).findFirst().orElse(null);
    }
    List<String> ids() { return nodes.stream().map(n -> (String) n.get("id")).sorted().collect(Collectors.toList()); }
    List<String> names() { return nodes.stream().map(n -> (String) n.get("name")).sorted().collect(Collectors.toList()); }
    List<String> kinds(String kind) {
      return nodes.stream().filter(n -> kind.equals(n.get("kind"))).map(n -> (String) n.get("name")).sorted().collect(Collectors.toList());
    }
    String edge(String from, String to) {
      return edges.stream().filter(e -> from.equals(e.get("from")) && to.equals(e.get("to")))
          .map(e -> (String) e.get("kind")).findFirst().orElse(null);
    }
    List<String> containersOf(String id) {
      return edges.stream().filter(e -> "contains".equals(e.get("kind")) && id.equals(e.get("to")))
          .map(e -> (String) e.get("from")).sorted().collect(Collectors.toList());
    }
    @SuppressWarnings("unchecked")
    List<String> members(String id) {
      Map<String, Object> n = node(id);
      if (n == null || n.get("members") == null) return List.of();
      return ((List<Object>) n.get("members")).stream()
          .map(m -> (String) ((Map<String, Object>) m).get("name")).sorted().collect(Collectors.toList());
    }
    Object field(String id, String key) {
      Map<String, Object> n = node(id);
      return n == null ? null : n.get(key);
    }
  }

  /** Just enough JSON to read a document back. */
  static final class Json {
    private final String s; private int i;
    private Json(String s) { this.s = s; }
    static Object parse(String s) { Json j = new Json(s); j.ws(); Object v = j.value(); return v; }
    private void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }
    private Object value() {
      char c = s.charAt(i);
      switch (c) {
        case '{': return obj();
        case '[': return arr();
        case '"': return str();
        case 't': i += 4; return Boolean.TRUE;
        case 'f': i += 5; return Boolean.FALSE;
        case 'n': i += 4; return null;
        default: return num();
      }
    }
    private Map<String, Object> obj() {
      Map<String, Object> m = new LinkedHashMap<>(); i++; ws();
      if (s.charAt(i) == '}') { i++; return m; }
      while (true) {
        ws(); String k = str(); ws(); i++; ws(); m.put(k, value()); ws();
        if (s.charAt(i) == ',') { i++; continue; }
        i++; return m;
      }
    }
    private List<Object> arr() {
      List<Object> l = new ArrayList<>(); i++; ws();
      if (s.charAt(i) == ']') { i++; return l; }
      while (true) {
        ws(); l.add(value()); ws();
        if (s.charAt(i) == ',') { i++; continue; }
        i++; return l;
      }
    }
    private String str() {
      StringBuilder b = new StringBuilder(); i++;
      while (s.charAt(i) != '"') {
        char c = s.charAt(i++);
        if (c == '\\') {
          char e = s.charAt(i++);
          switch (e) {
            case 'n': b.append('\n'); break;
            case 't': b.append('\t'); break;
            case 'r': b.append('\r'); break;
            case 'b': b.append('\b'); break;
            case 'f': b.append('\f'); break;
            case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
            default: b.append(e);
          }
        } else b.append(c);
      }
      i++;
      return b.toString();
    }
    private Object num() {
      int start = i;
      while (i < s.length() && "-+.eE0123456789".indexOf(s.charAt(i)) >= 0) i++;
      String t = s.substring(start, i);
      return t.contains(".") ? (Object) Double.parseDouble(t) : (Object) Long.parseLong(t);
    }
  }

  public static void main(String[] args) throws Exception {
    loadAnalyzer();
    Rules.run();
    if (failures.isEmpty()) {
      System.out.println(checks + " assertions passed");
    } else {
      System.out.println(failures.size() + " / " + checks + " failed:");
      for (String f : failures.subList(0, Math.min(failures.size(), 25))) System.out.println("  ✗ " + f);
      System.exit(1);
    }
  }
}

/** The rules, one group per heading below. */
class Rules extends Tests {
  static void run() {
    walking();
    sourceRoots();
    nodesAndNames();
    visibility();
    members();
    packages();
    edges();
    edgeKinds();
    resolution();
    fileNodes();
    compactFile();
    serialisation();
  }

  // -- walking ---------------------------------------------------------------

  static void walking() {
    suite("walk: source roots, skipped directories");
    Project p = new Project(
        "src/main/java/a/b/Kept.java", "package a.b;\npublic class Kept {}\n",
        "target/generated/a/b/Built.java", "package a.b;\npublic class Built {}\n",
        "build/a/b/Gradled.java", "package a.b;\npublic class Gradled {}\n",
        "out/a/b/Ide.java", "package a.b;\npublic class Ide {}\n",
        "src/test/java/a/b/Tested.java", "package a.b;\npublic class Tested {}\n",
        "docs/a/Doc.java", "package a;\npublic class Doc {}\n",
        "examples/a/Example.java", "package a;\npublic class Example {}\n",
        "node_modules/a/Dep.java", "package a;\npublic class Dep {}\n",
        ".git/a/Git.java", "package a;\npublic class Git {}\n",
        "pom.xml", "<project><artifactId>demo</artifactId></project>\n");
    Doc d = p.doc();
    ok(d.node(p.id("src/main/java/a/b/Kept.java", "class", "Kept")) != null, "a class the walk reaches is in the graph");
    for (String name : List.of("Built", "Gradled", "Ide", "Tested", "Doc", "Example", "Dep", "Git")) {
      ok(!d.names().contains(name), name + " is in a directory that should be skipped and must not appear");
    }

    suite("walk: analyzes a project with no build file");
    Project bare = new Project("a/b/Loose.java", "package a.b;\npublic class Loose {}\n");
    ok(bare.doc().names().contains("Loose"), "analyzes without a pom.xml or build.gradle");
  }

  // -- source roots ----------------------------------------------------------

  static void sourceRoots() {
    suite("source roots: a same-named class in two roots is two nodes");
    Project p = new Project(
        "guava/src/a/b/Maps.java", "package a.b;\npublic class Maps {}\n",
        "android/guava/src/a/b/Maps.java", "package a.b;\npublic class Maps {}\n");
    Doc d = p.doc();
    ok(d.node(p.id("guava/src/a/b/Maps.java", "class", "Maps")) != null, "the first root's Maps is in the graph");
    ok(d.node(p.id("android/guava/src/a/b/Maps.java", "class", "Maps")) != null, "the mirror root's Maps is in the graph too");
    eq(d.kinds("package").size(), 2, "each root has its own package node");

    suite("source roots: a file with no package declaration");
    Project none = new Project("loose/Script.java", "public class Script {}\n");
    Doc nd = none.doc();
    ok(nd.names().contains("Script"), "a file with no package is still analyzed");
    eq(nd.kinds("package").size(), 0, "no package declaration means no package node");
  }

  // -- nodes and names -------------------------------------------------------

  static void nodesAndNames() {
    suite("nodes: the five declaration kinds");
    Project p = new Project("src/a/All.java", String.join("\n",
        "package a;",
        "public class All {}",
        "interface Face {}",
        "enum Colour { RED }",
        "record Point(int x, int y) {}",
        "@interface Marker {}", ""));
    Doc d = p.doc();
    eq(d.kinds("class"), List.of("All"), "class node");
    eq(d.kinds("interface"), List.of("Face"), "interface node");
    eq(d.kinds("enum"), List.of("Colour"), "enum node");
    eq(d.kinds("record"), List.of("Point"), "record node");
    eq(d.kinds("annotation"), List.of("Marker"), "annotation node");

    suite("nodes: a nested type carries its outer type's name");
    Project n = new Project("src/a/Maps.java", String.join("\n",
        "package a;",
        "public class Maps {",
        "  public static class KeySet {",
        "    static class Deeper {}",
        "  }",
        "}", ""));
    Doc nd = n.doc();
    ok(nd.node(n.id("src/a/Maps.java", "class", "Maps.KeySet")) != null, "the nested type is named Maps.KeySet");
    ok(nd.node(n.id("src/a/Maps.java", "class", "Maps.KeySet.Deeper")) != null, "one level further is named Maps.KeySet.Deeper");
    eq(nd.field(n.id("src/a/Maps.java", "class", "Maps.KeySet"), "line"), 3L, "a nested type sits on the line that declares it");

    suite("nodes: two same-named nested types in one file");
    Project two = new Project("src/a/Pair.java", String.join("\n",
        "package a;",
        "public class Pair {",
        "  class KeySet {}",
        "}",
        "class Other {",
        "  class KeySet {}",
        "}", ""));
    Doc td = two.doc();
    ok(td.node(two.id("src/a/Pair.java", "class", "Pair.KeySet")) != null, "Pair.KeySet is in the graph");
    ok(td.node(two.id("src/a/Pair.java", "class", "Other.KeySet")) != null, "Other.KeySet is in the graph");

    suite("nodes: local and anonymous classes stay out of the graph");
    Project local = new Project("src/a/Host.java", String.join("\n",
        "package a;",
        "public class Host {",
        "  Runnable go() {",
        "    class Local {}",
        "    return new Runnable() { public void run() {} };",
        "  }",
        "}", ""));
    Doc ld = local.doc();
    ok(ld.names().contains("Host"), "the outer class is in the graph");
    ok(ld.names().stream().noneMatch(x -> x.contains("Local")), "a class declared in a method is not a node");
    eq(ld.nodes.stream().filter(x -> "class".equals(x.get("kind"))).count(), 1L, "an anonymous class is not a node");
  }

  // -- visibility ------------------------------------------------------------

  static void visibility() {
    suite("visibility: the internal flag");
    Project p = new Project("src/a/Vis.java", String.join("\n",
        "package a;",
        "public class Vis {",
        "  public static class Open {}",
        "  protected static class Sub {}",
        "  static class Shared {}",
        "  private static class Shut {}",
        "}",
        "class Helper {}", ""));
    Doc d = p.doc();
    String f = "src/a/Vis.java";
    eq(d.field(p.id(f, "class", "Vis"), "internal"), null, "a public type is not internal");
    eq(d.field(p.id(f, "class", "Vis.Open"), "internal"), null, "a public nested type is not internal");
    eq(d.field(p.id(f, "class", "Vis.Sub"), "internal"), null, "a protected nested type is not internal");
    eq(d.field(p.id(f, "class", "Vis.Shared"), "internal"), Boolean.TRUE, "package-private is internal");
    eq(d.field(p.id(f, "class", "Vis.Shut"), "internal"), Boolean.TRUE, "private is internal");
    eq(d.field(p.id(f, "class", "Helper"), "internal"), Boolean.TRUE, "top-level but not public is internal");
  }

  // -- members ---------------------------------------------------------------

  static void members() {
    suite("members: methods and constructors");
    Project p = new Project("src/a/Thing.java", String.join("\n",
        "package a;",
        "public class Thing {",
        "  private int count;",
        "  public Thing() {}",
        "  public Thing(int c) { count = c; }",
        "  public int size() { return count; }",
        "  static class Inner {",
        "    void hop() {}",
        "  }",
        "}",
        "enum Colour { RED, GREEN; void shine() {} }", ""));
    Doc d = p.doc();
    String f = "src/a/Thing.java";
    eq(d.members(p.id(f, "class", "Thing")), List.of("Thing", "Thing", "size"), "methods and constructors are members; a constructor takes the type's name");
    eq(d.members(p.id(f, "class", "Thing.Inner")), List.of("hop"), "a nested type's methods belong to it");
    ok(!d.members(p.id(f, "class", "Thing")).contains("count"), "fields are not members");
    eq(d.members(p.id(f, "enum", "Colour")), List.of("shine"), "enum constants are not members");
  }

  // -- packages --------------------------------------------------------------

  static void packages() {
    suite("packages: node, location and containment");
    Project p = new Project(
        "src/a/b/package-info.java", "/** Docs. */\npackage a.b;\n",
        "src/a/b/Outer.java", "package a.b;\npublic class Outer {\n  static class Inner {}\n}\n",
        "src/a/b/c/Deep.java", "package a.b.c;\npublic class Deep {}\n");
    Doc d = p.doc();
    String pkg = p.id("src/a/b/package-info.java", "package", "a.b");
    ok(d.node(pkg) != null, "the package node sits in package-info.java");
    eq(d.field(pkg, "line"), 2L, "the package node sits on the package line");
    eq(d.containersOf(p.id("src/a/b/Outer.java", "class", "Outer")), List.of(pkg), "a package contains its top-level types");
    eq(d.containersOf(p.id("src/a/b/Outer.java", "class", "Outer.Inner")), List.of(pkg), "a package contains nested types too");
    String deep = p.id("src/a/b/c/Deep.java", "package", "a.b.c");
    ok(d.node(deep) != null, "a.b.c is its own package node");
    eq(d.containersOf(deep), List.of(), "a package does not contain packages");

    suite("packages: with no package-info the node sits in the first file");
    Project q = new Project(
        "src/a/Zeta.java", "package a;\npublic class Zeta {}\n",
        "src/a/Alpha.java", "package a;\npublic class Alpha {}\n");
    Doc qd = q.doc();
    ok(qd.node(q.id("src/a/Alpha.java", "package", "a")) != null, "the package node sits in the first file by path order");
  }

  // -- edges -----------------------------------------------------------------

  static void edges() {
    suite("edges: extends and implements are both inherits");
    Project p = new Project(
        "src/a/Base.java", "package a;\npublic class Base {}\n",
        "src/a/Face.java", "package a;\npublic interface Face {}\n",
        "src/a/Other.java", "package a;\npublic interface Other {}\n",
        "src/a/Child.java", "package a;\nimport java.util.List;\npublic class Child extends Base implements Face, Other {\n  List<String> xs;\n}\n");
    Doc d = p.doc();
    String child = p.id("src/a/Child.java", "class", "Child");
    eq(d.edge(child, p.id("src/a/Base.java", "class", "Base")), "inherits", "extends is inherits");
    eq(d.edge(child, p.id("src/a/Face.java", "interface", "Face")), "inherits", "implements is inherits");
    eq(d.edge(child, p.id("src/a/Other.java", "interface", "Other")), "inherits", "so is the second interface");
    ok(d.edges.stream().noneMatch(e -> String.valueOf(e.get("to")).contains("java.util")), "an external type creates no node");

    suite("edges: sealed draws only the edge the subtype declares");
    Project s = new Project(
        "src/a/Shape.java", "package a;\npublic sealed interface Shape permits Circle {}\n",
        "src/a/Circle.java", "package a;\npublic final class Circle implements Shape {}\n");
    Doc sd = s.doc();
    eq(sd.edge(s.id("src/a/Circle.java", "class", "Circle"), s.id("src/a/Shape.java", "interface", "Shape")),
        "inherits", "the subtype points to the sealed interface");
    eq(sd.edge(s.id("src/a/Shape.java", "interface", "Shape"), s.id("src/a/Circle.java", "class", "Circle")),
        null, "permits draws no extra edge");

    suite("edges: references in methods and anonymous classes count for the outer type");
    Project m = new Project(
        "src/a/Tool.java", "package a;\npublic class Tool { public static void use() {} }\n",
        "src/a/Caller.java", String.join("\n",
            "package a;",
            "public class Caller {",
            "  void go() {",
            "    Tool.use();",
            "    Runnable r = new Runnable() { public void run() { Tool.use(); } };",
            "  }",
            "}", ""));
    Doc md = m.doc();
    ok(md.edge(m.id("src/a/Caller.java", "class", "Caller"), m.id("src/a/Tool.java", "class", "Tool")) != null,
        "a reference inside a method starts from the outer type");
  }

  static void edgeKinds() {
    suite("edges: declaration positions are references, executable positions are uses");
    Project p = new Project(
        "src/a/Sig.java", "package a;\npublic class Sig {}\n",
        "src/a/Body.java", "package a;\npublic class Body { public static void go() {} }\n",
        "src/a/Mark.java", "package a;\npublic @interface Mark {}\n",
        "src/a/User.java", String.join("\n",
            "package a;",
            "public class User {",
            "  @Mark",
            "  Sig take(Sig s) { Body.go(); return s; }",
            "}", ""));
    Doc d = p.doc();
    String user = p.id("src/a/User.java", "class", "User");
    eq(d.edge(user, p.id("src/a/Sig.java", "class", "Sig")), "references", "parameter and return types are references");
    eq(d.edge(user, p.id("src/a/Mark.java", "annotation", "Mark")), "references", "an annotation on a method is references");
    eq(d.edge(user, p.id("src/a/Body.java", "class", "Body")), "uses", "a call in a method body is uses");
  }

  // -- resolution ------------------------------------------------------------

  static void resolution() {
    suite("resolution: qualified names connect across source roots");
    Project p = new Project(
        "mod-a/src/main/java/a/Api.java", "package a;\npublic class Api {}\n",
        "mod-b/src/main/java/b/Impl.java", "package b;\nimport a.Api;\npublic class Impl { Api api; }\n");
    Doc d = p.doc();
    ok(d.edge(p.id("mod-b/src/main/java/b/Impl.java", "class", "Impl"),
              p.id("mod-a/src/main/java/a/Api.java", "class", "Api")) != null, "a reference across roots has an edge");

    suite("resolution: an unresolved external name draws nothing");
    Project q = new Project("src/a/Uses.java",
        "package a;\nimport com.external.Thing;\npublic class Uses extends Thing { }\n");
    Doc qd = q.doc();
    ok(qd.names().contains("Uses"), "with an external dependency the type itself is still in the graph");
    eq(qd.edges.size(), 1, "only the package's contains remains; the external name is not drawn");

    suite("resolution: errors do not stop the rest of the root");
    Project r = new Project(
        "src/a/Broken.java", "package a;\nimport com.nope.Missing;\npublic class Broken extends Missing { Helper h; }\n",
        "src/a/Helper.java", "package a;\npublic class Helper { void hop() {} }\n",
        "src/a/Third.java", "package a;\npublic class Third { Helper h; }\n");
    Doc rd = r.doc();
    ok(rd.names().contains("Broken") && rd.names().contains("Helper") && rd.names().contains("Third"),
        "one file failing to resolve must not make the whole root disappear");
    ok(rd.edge(r.id("src/a/Third.java", "class", "Third"), r.id("src/a/Helper.java", "class", "Helper")) != null,
        "the other files' edges still resolve");
    ok(rd.edge(r.id("src/a/Broken.java", "class", "Broken"), r.id("src/a/Helper.java", "class", "Helper")) != null,
        "in the failing file, names that do resolve still become edges");
  }

  // -- file nodes ------------------------------------------------------------

  static void fileNodes() {
    suite("file nodes: only a file that declares nothing has one");
    Project p = new Project(
        "src/a/package-info.java", "package a;\n",
        "src/a/Type.java", "package a;\npublic class Type {}\n",
        "src/a/module-info.java", "module a.mod { exports a; }\n");
    Doc d = p.doc();
    eq(d.kinds("file"), List.of(), "files with types, package-info and module-info have no file node");
    ok(d.node(p.id("src/a/package-info.java", "package", "a")) != null, "package-info is represented by the package node");
    ok(d.names().stream().noneMatch(x -> x.contains("a.mod")), "module-info produces no node");
  }

  static void compactFile() {
    suite("no line spells its name, so it is not a node");
    // A Java 25 compact source file: no class declaration; the compiler synthesizes a class from the file name.
    // The junit5 corpus has two such files.
    Project p = new Project(
        "src/Runner.java", "void main() {\n  System.out.println(1);\n}\n",
        "src/a/Real.java", "package a;\npublic class Real {}\n");
    Doc d = p.doc();
    ok(d.names().contains("Real"), "an ordinary class is still in the graph");
    ok(!d.names().contains("Runner"), "a compiler-synthesized class is not a node");
    eq(d.kinds("file"), List.of("Runner.java"), "that file is represented by a file node");
  }

  // -- serialisation ---------------------------------------------------------

  static void serialisation() {
    suite("serialization: bytes");
    Project p = new Project(
        "src/a/Zed.java", "package a;\npublic class Zed extends Ay {}\n",
        "src/a/Ay.java", "package a;\npublic class Ay { void 名字() {} }\n");
    String once = p.json();
    String twice = p.json();
    eq(twice, once, "the same source run twice gives the same bytes");
    ok(once.endsWith("}\n"), "the file ends with a newline");
    ok(!once.endsWith("\n\n"), "the file does not end with more than one newline");
    ok(once.contains("\n  \"nodes\": ["), "two-space indent");
    ok(!once.matches("(?s).*\\\\u[0-9a-fA-F]{4}.*"), "no backslash-u escapes");
    ok(once.contains("名字"), "non-ASCII is written as itself");
    Doc d = new Doc(once);
    List<List<String>> keys = new ArrayList<>();
    for (Map<String, Object> e : d.edges) {
      keys.add(List.of((String) e.get("from"), (String) e.get("to"), (String) e.get("kind")));
    }
    List<List<String>> sorted = new ArrayList<>(keys);
    sorted.sort(Comparator.<List<String>, String>comparing(k -> k.get(0))
        .thenComparing(k -> k.get(1)).thenComparing(k -> k.get(2)));
    eq(keys, sorted, "edges are sorted by from, to, kind");
  }
}
