//! Planisphere's Java analyzer: read Java source and write the structure document.
//!
//! One file, because Java 21 runs a program from source only when it is one
//! file, and running from source is what lets this analyzer have no build step,
//! no dependency and no lockfile. The JDK's own compiler is the parser and the
//! resolver: `ToolProvider.getSystemJavaCompiler()` is present in a runtime that
//! carries `jdk.compiler`, with or without a `javac` binary beside it.
//!
//! bin/planisphere runs this as `java Analyzer.java`. The caller's directory
//! arrives as PLANISPHERE_CWD, and relative roots and -o are resolved against it.

import com.sun.source.tree.*;
import com.sun.source.util.*;
import javax.lang.model.element.*;
import javax.lang.model.util.Elements;
import javax.lang.model.type.*;
import javax.tools.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;

public final class Analyzer {

  static final String USAGE = String.join("\n",
      "Usage: planisphere-java [roots...] [-o OUT] [--stdout]",
      "",
      "Analyze Java symbol structure and write a *.planisphere.json graph.",
      "",
      "  roots           project root(s) to scan (default: .)",
      "  -o, --output    output path (default: ./planisphere.json)",
      "  --stdout        print JSON to stdout instead of writing a file",
      "");

  public static void main(String[] args) {
    List<String> roots = new ArrayList<>();
    String output = "planisphere.json";
    boolean toStdout = false;
    for (int i = 0; i < args.length; i++) {
      String a = args[i];
      switch (a) {
        case "-h": case "--help": System.out.print(USAGE); return;
        case "--stdout": toStdout = true; break;
        case "-o": case "--output":
          if (++i >= args.length) { System.err.println("planisphere-java: -o needs a path"); System.exit(2); }
          output = args[i];
          break;
        default:
          if (a.startsWith("-")) {
            System.err.print("planisphere-java: unknown option " + a + "\n" + USAGE);
            System.exit(2);
          }
          roots.add(a);
      }
    }
    if (roots.isEmpty()) roots.add(".");

    Path base = Paths.get(Optional.ofNullable(System.getenv("PLANISPHERE_CWD")).orElse(System.getProperty("user.dir")));
    List<String> abs = new ArrayList<>();
    for (String r : roots) abs.add(resolve(base, r).toString());

    String text;
    Graph g;
    try {
      g = analyze(abs);
      text = encode(g);
    } catch (Throwable e) {
      // Never a partial artifact reported as success.
      System.err.println("planisphere-java: the analysis failed, and no artifact was written");
      System.err.println("planisphere-java: " + e);
      System.exit(1);
      return;
    }
    if (toStdout) { System.out.print(text); return; }
    Path out = resolve(base, output);
    try {
      Files.writeString(out, text, StandardCharsets.UTF_8);
    } catch (IOException e) {
      System.err.println("planisphere-java: " + e);
      System.exit(1);
      return;
    }
    System.err.println("Wrote " + out + " (" + g.nodes.size() + " nodes, " + g.edges.size() + " edges)");
  }

  static Path resolve(Path base, String p) {
    Path path = Paths.get(p);
    return (path.isAbsolute() ? path : base.resolve(path)).normalize();
  }

  /** What the tests call: the document for these roots, as text. */
  public static String analyzeToJson(List<String> roots) {
    return encode(analyze(roots));
  }

  // ==========================================================================
  // The document
  // ==========================================================================

  static final class Member {
    final String name, file; final int line;
    /** The members of the same type this one calls, by name. */
    final List<String> calls = new ArrayList<>();
    /**
     * The nodes this member's signature and body name, by id. Each one is a
     * target its own node has an edge to; the member says which method that
     * edge came from.
     */
    final List<String> points = new ArrayList<>();
    Member(String name, String file, int line) { this.name = name; this.file = file; this.line = line; }
  }

  static final class Node {
    String id, kind, name, file;
    int line;
    Integer endLine;
    boolean internal;
    final List<Member> members = new ArrayList<>();
    Node(String kind, String name, String file, int line) {
      this.kind = kind; this.name = name; this.file = file; this.line = line;
      this.id = file + "::" + kind + "::" + name;
    }
  }

  static final class Edge {
    final String from, to, kind;
    Edge(String from, String to, String kind) { this.from = from; this.to = to; this.kind = kind; }
  }

  static final class Graph {
    final List<Node> nodes = new ArrayList<>();
    final List<Edge> edges = new ArrayList<>();
  }

  /** Edge kinds, weakest first: the artifact keeps the most specific per pair. */
  static final List<String> KINDS = List.of("references", "uses", "inherits", "contains");

  // ==========================================================================
  // Walking
  // ==========================================================================

  /**
   * Directories no analyzer walks, and the three where Java's build tools write
   * output. A directory whose name begins with "." is skipped as well: it is a
   * tool's own, not the project's source.
   */
  static final Set<String> SKIP = Set.of(
      ".git", ".hg", ".svn",
      "node_modules", "dist", "build",
      ".idea", ".vscode",
      "tests", "test", "__tests__", "testing",
      "docs", "examples",
      "target", "out");

  static List<Path> walk(List<String> roots) {
    List<Path> found = new ArrayList<>();
    for (String r : roots) {
      Path root = Paths.get(r);
      if (!Files.exists(root)) continue;
      walkInto(root, found, true);
    }
    found.sort(Comparator.comparing(Path::toString));
    return found;
  }

  static void walkInto(Path dir, List<Path> found, boolean isRoot) {
    if (Files.isRegularFile(dir)) {
      if (dir.toString().endsWith(".java")) found.add(dir.toAbsolutePath().normalize());
      return;
    }
    if (!Files.isDirectory(dir)) return;
    String name = dir.getFileName() == null ? "" : dir.getFileName().toString();
    if (!isRoot && (SKIP.contains(name) || (name.startsWith(".") && !name.equals(".")))) return;
    List<Path> children = new ArrayList<>();
    try (DirectoryStream<Path> s = Files.newDirectoryStream(dir)) {
      for (Path p : s) children.add(p);
    } catch (IOException e) {
      return;
    }
    children.sort(Comparator.comparing(Path::toString));
    for (Path p : children) {
      if (Files.isDirectory(p)) walkInto(p, found, false);
      else if (p.toString().endsWith(".java") && !p.getFileName().toString().equals("module-info.java")) {
        found.add(p.toAbsolutePath().normalize());
      }
    }
  }

  static final Pattern PACKAGE_LINE = Pattern.compile("(?m)^[ \\t]*package[ \\t]+([\\w.]+)[ \\t]*;");

  /** The package a file declares, read from its text, or "" for none. */
  static String packageOf(String text) {
    Matcher m = PACKAGE_LINE.matcher(text);
    return m.find() ? m.group(1) : "";
  }

  /**
   * A file's source root: its directory with its package path removed.
   *
   * This is what makes the analyzer independent of Maven and Gradle, and what
   * keeps a repository that mirrors its sources — guava's `android/` tree — from
   * being read as one program with ninety duplicate classes in it.
   */
  static String sourceRoot(Path file, String pkg) {
    Path dir = file.getParent();
    if (pkg.isEmpty() || dir == null) return String.valueOf(dir);
    String suffix = File.separator + pkg.replace(".", File.separator);
    String d = dir.toString();
    return d.endsWith(suffix) ? d.substring(0, d.length() - suffix.length()) : d;
  }

  // ==========================================================================
  // The analysis
  // ==========================================================================

  static Graph analyze(List<String> roots) {
    List<Path> files = walk(roots);
    Map<String, String> texts = new LinkedHashMap<>();
    Map<String, List<Path>> byRoot = new LinkedHashMap<>();
    for (Path f : files) {
      String text;
      try { text = Files.readString(f, StandardCharsets.UTF_8); }
      catch (IOException e) { continue; }
      texts.put(f.toString(), text);
      byRoot.computeIfAbsent(sourceRoot(f, packageOf(text)), k -> new ArrayList<>()).add(f);
    }

    Graph g = new Graph();
    // Every node by the qualified name the compiler would call it, per root and
    // then across roots: a reference into another root resolves by name alone.
    Map<String, Map<String, String>> byRootQname = new LinkedHashMap<>();
    Map<String, String> anyQname = new LinkedHashMap<>();
    List<Pending> pending = new ArrayList<>();
    Set<String> filesWithNodes = new HashSet<>();
    Set<String> packagePlaced = new HashSet<>();

    for (Map.Entry<String, List<Path>> e : byRoot.entrySet()) {
      Root r = new Root(e.getKey(), e.getValue(), texts);
      r.read(g, pending);
      byRootQname.put(e.getKey(), r.qnames);
      for (Map.Entry<String, String> q : r.qnames.entrySet()) anyQname.putIfAbsent(q.getKey(), q.getValue());
      filesWithNodes.addAll(r.filesWithNodes);
      packagePlaced.addAll(r.packageFiles);
    }

    // A file that declares nothing, and that no unit's node stands in for.
    for (Path f : files) {
      String s = f.toString();
      if (filesWithNodes.contains(s) || packagePlaced.contains(s)) continue;
      if (!texts.containsKey(s)) continue;
      Node n = new Node("file", f.getFileName().toString(), s, 1);
      g.nodes.add(n);
    }

    // Edges, once every root's nodes are known, so that a name reaching into
    // another root finds it.
    Map<String, String> best = new LinkedHashMap<>();
    for (Pending p : pending) {
      Map<String, String> own = byRootQname.getOrDefault(p.root, Map.of());
      String to = own.containsKey(p.qname) ? own.get(p.qname) : anyQname.get(p.qname);
      if (to == null || to.equals(p.from)) continue;
      if (p.member != null && !p.member.points.contains(to)) p.member.points.add(to);
      String key = p.from + "\n" + to;
      String had = best.get(key);
      if (had == null || KINDS.indexOf(p.kind) > KINDS.indexOf(had)) best.put(key, p.kind);
    }
    for (Map.Entry<String, String> e : best.entrySet()) {
      String[] pair = e.getKey().split("\n", 2);
      g.edges.add(new Edge(pair[0], pair[1], e.getValue()));
    }

    // A call is kept only where the name is a member of the same node: a class
    // is read in one pass, and a call may be written above the method it names.
    for (Node n : g.nodes) {
      Set<String> own = new HashSet<>();
      for (Member m : n.members) own.add(m.name);
      for (Member m : n.members) m.calls.retainAll(own);
    }

    // What a member points at is which of its node's edges came from it, and
    // which edge a name ends up as is settled only here: a pair carries one
    // edge, and a name that resolved to nothing carries none.
    Map<String, Set<String>> out = new HashMap<>();
    for (Edge e : g.edges) out.computeIfAbsent(e.from, k -> new HashSet<>()).add(e.to);
    for (Node n : g.nodes) {
      Set<String> here = out.getOrDefault(n.id, Set.of());
      for (Member m : n.members) m.points.retainAll(here);
    }

    g.nodes.sort(Comparator.comparing((Node n) -> n.file).thenComparingInt(n -> n.line).thenComparing(n -> n.name));
    g.edges.sort(Comparator.comparing((Edge x) -> x.from).thenComparing(x -> x.to).thenComparing(x -> x.kind));
    return g;
  }

  /** An edge waiting for every root to be read, so its target can be found. */
  static final class Pending {
    final String root, from, qname, kind;
    /** The member whose signature or body wrote this name, where one did. */
    final Member member;
    Pending(String root, String from, String qname, String kind, Member member) {
      this.root = root; this.from = from; this.qname = qname; this.kind = kind; this.member = member;
    }
  }

  // ==========================================================================
  // One source root, compiled on its own
  // ==========================================================================

  static final class Root {
    final String root;
    final List<Path> files;
    final Map<String, String> texts;
    /** Fully qualified name to node id, for this root. */
    final Map<String, String> qnames = new LinkedHashMap<>();
    final Set<String> filesWithNodes = new HashSet<>();
    final Set<String> packageFiles = new HashSet<>();

    Root(String root, List<Path> files, Map<String, String> texts) {
      this.root = root; this.files = files; this.texts = texts;
    }

    void read(Graph g, List<Pending> pending) {
      JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
      if (compiler == null) {
        throw new IllegalStateException("this Java runtime carries no compiler module (jdk.compiler)");
      }
      StandardJavaFileManager fm = compiler.getStandardFileManager(null, null, StandardCharsets.UTF_8);
      Writer quiet = new StringWriter();
      // Told to carry on after an error, because a project analyzed without its
      // dependencies always has them: left to stop, javac finishes the analyze
      // phase for no file at all and returns nothing.
      List<String> options = List.of(
          "-proc:none", "-nowarn", "-Xlint:none",
          "-XDshould-stop.ifError=GENERATE", "-XDshould-stop.ifNoError=GENERATE");
      JavacTask task = (JavacTask) compiler.getTask(quiet, fm, d -> {}, options, null,
          fm.getJavaFileObjectsFromPaths(files));
      Trees trees = Trees.instance(task);
      Elements elements = task.getElements();
      List<CompilationUnitTree> units = new ArrayList<>();
      try {
        for (CompilationUnitTree u : task.parse()) units.add(u);
        task.analyze();
      } catch (Throwable e) {
        // A compiler that fell over still parsed something; what it gave is read.
      }

      // The package node for each package in this root, placed on the line that
      // declares it: `package-info.java` where there is one, else the first file.
      Map<String, Node> packages = new LinkedHashMap<>();
      Map<String, List<Node>> inPackage = new LinkedHashMap<>();

      for (CompilationUnitTree unit : units) {
        Path path;
        try { path = Paths.get(unit.getSourceFile().toUri()).toAbsolutePath().normalize(); }
        catch (Exception e) { continue; }
        String file = path.toString();
        String text = texts.get(file);
        if (text == null) continue;
        String pkg = unit.getPackageName() == null ? "" : unit.getPackageName().toString();

        Unit u = new Unit(this, g, pending, trees, elements, unit, file, text, pkg);
        u.scan(new TreePath(unit), null);
        if (!u.declared.isEmpty()) filesWithNodes.add(file);
        for (Node n : u.declared) inPackage.computeIfAbsent(pkg, k -> new ArrayList<>()).add(n);

        if (!pkg.isEmpty()) {
          Node had = packages.get(pkg);
          boolean isInfo = path.getFileName().toString().equals("package-info.java");
          if (had == null || (isInfo && !had.file.endsWith("package-info.java"))) {
            int line = packageLine(text);
            if (line > 0) {
              Node n = new Node("package", pkg, file, line);
              packages.put(pkg, n);
            }
          }
        }
      }

      for (Node p : packages.values()) {
        g.nodes.add(p);
        packageFiles.add(p.file);
        for (Node n : inPackage.getOrDefault(p.name, List.of())) {
          g.edges.add(new Edge(p.id, n.id, "contains"));
        }
      }
    }

    static int packageLine(String text) {
      Matcher m = PACKAGE_LINE.matcher(text);
      if (!m.find()) return 0;
      return lineOf(text, m.start());
    }
  }

  static int lineOf(String text, int offset) {
    int line = 1;
    for (int i = 0; i < offset && i < text.length(); i++) if (text.charAt(i) == '\n') line++;
    return line;
  }

  // ==========================================================================
  // One compilation unit
  // ==========================================================================

  static final class Unit extends TreePathScanner<Void, Void> {
    final Root root;
    final Graph g;
    final List<Pending> pending;
    final Trees trees;
    final Elements elements;
    final SourcePositions positions;
    final CompilationUnitTree unit;
    final String file, text, pkg;
    final List<Node> declared = new ArrayList<>();
    /** The types this declaration sits inside, outermost first. */
    final Deque<String> enclosing = new ArrayDeque<>();
    /** The node a reference found here belongs to. */
    final Deque<Node> owner = new ArrayDeque<>();
    /** Where each enclosing class declaration starts, to spot what javac added. */
    final Deque<Integer> classStart = new ArrayDeque<>();
    /** A `permits` clause names its own subtypes, which name it back. */
    final Set<Tree> permits = Collections.newSetFromMap(new IdentityHashMap<>());
    /** Simple name to qualified name, from this file's imports. */
    final Map<String, String> imported = new LinkedHashMap<>();
    final List<String> wildcards = new ArrayList<>();
    /** How deep inside a method, constructor or initializer we are. */
    int executable = 0;
    /** The member being read, so that what it names is recorded against it. */
    Member member;
    /** The node that member belongs to, which is the only node it speaks for. */
    Node memberOwner;

    Unit(Root root, Graph g, List<Pending> pending, Trees trees, Elements elements,
         CompilationUnitTree unit, String file, String text, String pkg) {
      this.root = root; this.g = g; this.pending = pending; this.trees = trees; this.elements = elements;
      this.positions = trees.getSourcePositions();
      this.unit = unit; this.file = file; this.text = text; this.pkg = pkg;
      for (ImportTree i : unit.getImports()) {
        if (i.isStatic() || i.getQualifiedIdentifier() == null) continue;
        String q = i.getQualifiedIdentifier().toString();
        if (q.endsWith(".*")) wildcards.add(q.substring(0, q.length() - 2));
        else imported.putIfAbsent(q.substring(q.lastIndexOf('.') + 1), q);
      }
    }

    @Override
    public Void visitClass(ClassTree tree, Void v) {
      String simple = tree.getSimpleName().toString();
      // An anonymous class has no name, and a class declared in a method body is
      // reachable from nowhere else: neither is a node, and what each names
      // belongs to the type that declares the method.
      if (simple.isEmpty() || executable > 0) return super.visitClass(tree, v);

      String kind = kindOf(tree);
      if (kind == null) return super.visitClass(tree, v);
      String name = enclosing.isEmpty() ? simple : String.join(".", enclosing) + "." + simple;

      int start = (int) positions.getStartPosition(unit, tree);
      int end = (int) positions.getEndPosition(unit, tree);
      int line = declarationLine(start, simple);
      // A compact source file declares no class: the compiler makes one from
      // the file's name, and no line in the source names it. A node's line must
      // contain its name, so there is no node — the file speaks for itself.
      if (line < 0) return super.visitClass(tree, v);
      Node node = new Node(kind, name, file, line);
      if (end > 0) node.endLine = lineOf(text, Math.min(end, text.length()));
      Set<Modifier> mods = tree.getModifiers().getFlags();
      node.internal = !mods.contains(Modifier.PUBLIC) && !mods.contains(Modifier.PROTECTED);
      g.nodes.add(node);
      declared.add(node);
      String qname = pkg.isEmpty() ? name : pkg + "." + name;
      root.qnames.putIfAbsent(qname, node.id);

      inherits(node, tree);

      for (Tree t : tree.getPermitsClause()) permits.add(t);
      enclosing.addLast(simple);
      owner.addLast(node);
      classStart.addLast(start);
      super.visitClass(tree, v);
      classStart.removeLast();
      owner.removeLast();
      enclosing.removeLast();
      return null;
    }

    /** `extends` and `implements`, taken from the element so generics resolve. */
    void inherits(Node node, ClassTree tree) {
      Element el = elementOf(getCurrentPath(), tree);
      if (!(el instanceof TypeElement te)) return;
      List<TypeMirror> supers = new ArrayList<>();
      supers.add(te.getSuperclass());
      supers.addAll(te.getInterfaces());
      for (TypeMirror t : supers) {
        String q = qualified(t);
        if (q != null && !q.equals("java.lang.Object")) {
          pending.add(new Pending(root.root, node.id, q, "inherits", null));
        }
      }
    }

    @Override
    public Void visitMethod(MethodTree tree, Void v) {
      Node here = owner.peekLast();
      int start = (int) positions.getStartPosition(unit, tree);
      // A class that declares no constructor is given one by the compiler. The
      // compiler is asked whether this one is in the source, rather than the
      // source being guessed at from a position.
      boolean written = start >= 0 && executable == 0 && explicit(getCurrentPath());
      Member outerMember = member;
      Node outerOwner = memberOwner;
      if (here != null && written) {
        boolean ctor = tree.getName().contentEquals("<init>");
        String simple = ctor ? lastSegment(here.name) : tree.getName().toString();
        Member m = new Member(simple, file, memberLine(start, simple));
        callsOnThis(tree.getBody(), m.calls);
        here.members.add(m);
        // What the rest of this declaration names is this member's, as well as
        // the type's.
        member = m;
        memberOwner = here;
      }
      // A signature is a declaration and a body is executable, which is the
      // difference between `references` and `uses`: an annotation on a method,
      // a parameter's type and a return type are all names in a declaration.
      scan(tree.getModifiers(), null);
      scan(tree.getReturnType(), null);
      for (Tree t : tree.getTypeParameters()) scan(t, null);
      for (Tree t : tree.getParameters()) scan(t, null);
      for (Tree t : tree.getThrows()) scan(t, null);
      executable++;
      scan(tree.getBody(), null);
      scan(tree.getDefaultValue(), null);
      executable--;
      member = outerMember;
      memberOwner = outerOwner;
      return null;
    }

    @Override
    public Void visitBlock(BlockTree tree, Void v) {
      // A static or instance initializer is executable too.
      executable++;
      super.visitBlock(tree, v);
      executable--;
      return null;
    }

    @Override
    public Void visitVariable(VariableTree tree, Void v) {
      // A field's type is a reference; what initializes it is executable.
      scan(tree.getType(), null);
      if (tree.getInitializer() != null) {
        executable++;
        scan(tree.getInitializer(), null);
        executable--;
      }
      return null;
    }

    @Override
    public Void visitIdentifier(IdentifierTree tree, Void v) {
      note();
      return null;
    }

    @Override
    public Void visitMemberSelect(MemberSelectTree tree, Void v) {
      note();
      return super.visitMemberSelect(tree, v);
    }

    /** A name in this position, where it resolves to a type. */
    void note() {
      Node here = owner.peekLast();
      if (here == null) return;
      Tree leaf = getCurrentPath().getLeaf();
      if (permits.contains(leaf)) return;
      Element el = elementOf(getCurrentPath(), leaf);
      if (!(el instanceof TypeElement te)) return;
      String q = te.getQualifiedName().toString();
      if (q.isEmpty()) return;
      String kind = executable > 0 ? "uses" : "references";
      // Only where the member belongs to the node this name is attributed to.
      // A class declared inside a method body is a node of its own, and what
      // it names is its own, not the enclosing method's.
      Member m = here == memberOwner ? member : null;
      pending.add(new Pending(root.root, here.id, q, kind, m));
      // A name in another source root does not resolve to a declaration, and
      // the compiler hands back the simple name it saw. What the file imported
      // says which type that was.
      if (q.indexOf('.') < 0) {
        String full = imported.get(q);
        if (full != null) pending.add(new Pending(root.root, here.id, full, kind, m));
        for (String w : wildcards) pending.add(new Pending(root.root, here.id, w + "." + q, kind, m));
      }
    }

    /** Did a person write this declaration, or did the compiler add it? */
    boolean explicit(TreePath path) {
      Element el = elementOf(path, path.getLeaf());
      if (el == null) return true;
      try { return elements.getOrigin(el) == Elements.Origin.EXPLICIT; }
      catch (Throwable e) { return true; }
    }

    Element elementOf(TreePath path, Tree tree) {
      try { return trees.getElement(path); } catch (Throwable e) { return null; }
    }

    static String qualified(TypeMirror t) {
      if (t == null || t.getKind() != TypeKind.DECLARED) return null;
      Element e = ((DeclaredType) t).asElement();
      return e instanceof TypeElement te ? te.getQualifiedName().toString() : null;
    }

    static String lastSegment(String name) {
      int i = name.lastIndexOf('.');
      return i < 0 ? name : name.substring(i + 1);
    }

    static String kindOf(ClassTree tree) {
      switch (tree.getKind()) {
        case CLASS: return "class";
        case INTERFACE: return "interface";
        case ENUM: return "enum";
        case RECORD: return "record";
        case ANNOTATION_TYPE: return "annotation";
        default: return null;
      }
    }

    /**
     * The line the name is declared on, not the line an annotation above it is.
     *
     * The compiler's start position is the first modifier or annotation, which
     * is what the artifact says a node's line is not, so the declaring keyword
     * is looked for in the source from there.
     */
    int declarationLine(int start, String simple) {
      if (start < 0 || start >= text.length()) return -1;
      Pattern p = Pattern.compile("\\b(class|interface|enum|record)\\s+" + Pattern.quote(simple) + "\\b");
      Matcher m = p.matcher(text);
      if (m.find(start)) return lineOf(text, m.start(1) + m.group(1).length() + 1);
      return -1;
    }

    /**
     * What a method calls of its own type, in the order the body writes them,
     * once each: a call written `this.name(…)`, or one written with no receiver
     * at all. Java writes most of its own calls the second way.
     *
     * The name is enough, and no type is inferred for it. Whether the type
     * declares a member under that name is settled later, once every member of
     * the type is in: a class's methods are read in one pass, but a call may be
     * written above the method it names.
     */
    void callsOnThis(Tree body, List<String> into) {
      if (body == null) return;
      new TreeScanner<Void, Void>() {
        @Override
        public Void visitMethodInvocation(MethodInvocationTree call, Void v) {
          ExpressionTree target = call.getMethodSelect();
          String name = null;
          if (target instanceof IdentifierTree id) {
            name = id.getName().toString();
          } else if (target instanceof MemberSelectTree sel
              && sel.getExpression() instanceof IdentifierTree on
              && on.getName().contentEquals("this")) {
            name = sel.getIdentifier().toString();
          }
          if (name != null && !into.contains(name)) into.add(name);
          return super.visitMethodInvocation(call, v);
        }
      }.scan(body, null);
    }

    int memberLine(int start, String simple) {
      if (start < 0 || start >= text.length()) return 1;
      Matcher m = Pattern.compile("\\b" + Pattern.quote(simple) + "\\s*\\(").matcher(text);
      if (m.find(start)) return lineOf(text, m.start());
      return lineOf(text, start);
    }
  }

  // ==========================================================================
  // The bytes
  // ==========================================================================

  /**
   * What `JSON.stringify(doc, null, 2) + "\n"` writes, which is the check the
   * contract applies. Key order is the order every producer uses, and a field
   * that does not hold is left out rather than written empty.
   */
  static String encode(Graph g) {
    StringBuilder b = new StringBuilder();
    b.append("{\n  \"nodes\": ");
    if (g.nodes.isEmpty()) b.append("[]");
    else {
      b.append("[\n");
      for (int i = 0; i < g.nodes.size(); i++) {
        Node n = g.nodes.get(i);
        b.append("    {\n");
        b.append("      \"id\": ").append(quote(n.id)).append(",\n");
        b.append("      \"kind\": ").append(quote(n.kind)).append(",\n");
        b.append("      \"name\": ").append(quote(n.name)).append(",\n");
        b.append("      \"file\": ").append(quote(n.file)).append(",\n");
        b.append("      \"line\": ").append(n.line);
        if (n.endLine != null) b.append(",\n      \"endLine\": ").append(n.endLine);
        if (n.internal) b.append(",\n      \"internal\": true");
        if (!n.members.isEmpty()) {
          b.append(",\n      \"members\": [\n");
          for (int j = 0; j < n.members.size(); j++) {
            Member m = n.members.get(j);
            b.append("        {\n");
            b.append("          \"name\": ").append(quote(m.name)).append(",\n");
            b.append("          \"file\": ").append(quote(m.file)).append(",\n");
            b.append("          \"line\": ").append(m.line);
            if (!m.calls.isEmpty()) {
              b.append(",\n          \"calls\": [\n");
              for (int c = 0; c < m.calls.size(); c++) {
                b.append("            ").append(quote(m.calls.get(c)));
                b.append(c + 1 < m.calls.size() ? ",\n" : "\n");
              }
              b.append("          ]");
            }
            if (!m.points.isEmpty()) {
              b.append(",\n          \"points\": [\n");
              for (int c = 0; c < m.points.size(); c++) {
                b.append("            ").append(quote(m.points.get(c)));
                b.append(c + 1 < m.points.size() ? ",\n" : "\n");
              }
              b.append("          ]");
            }
            b.append("\n");
            b.append("        }").append(j + 1 < n.members.size() ? ",\n" : "\n");
          }
          b.append("      ]");
        }
        b.append("\n    }").append(i + 1 < g.nodes.size() ? ",\n" : "\n");
      }
      b.append("  ]");
    }
    b.append(",\n  \"edges\": ");
    if (g.edges.isEmpty()) b.append("[]");
    else {
      b.append("[\n");
      for (int i = 0; i < g.edges.size(); i++) {
        Edge e = g.edges.get(i);
        b.append("    {\n");
        b.append("      \"from\": ").append(quote(e.from)).append(",\n");
        b.append("      \"to\": ").append(quote(e.to)).append(",\n");
        b.append("      \"kind\": ").append(quote(e.kind)).append("\n");
        b.append("    }").append(i + 1 < g.edges.size() ? ",\n" : "\n");
      }
      b.append("  ]");
    }
    b.append("\n}\n");
    return b.toString();
  }

  /**
   * JSON.stringify's escaping and no further: a quote, a backslash and the
   * control characters. `<`, `&` and non-ASCII are written as themselves.
   */
  static String quote(String s) {
    StringBuilder b = new StringBuilder("\"");
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"': b.append("\\\""); break;
        case '\\': b.append("\\\\"); break;
        case '\b': b.append("\\b"); break;
        case '\f': b.append("\\f"); break;
        case '\n': b.append("\\n"); break;
        case '\r': b.append("\\r"); break;
        case '\t': b.append("\\t"); break;
        default:
          if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
          else b.append(c);
      }
    }
    return b.append('"').toString();
  }
}
