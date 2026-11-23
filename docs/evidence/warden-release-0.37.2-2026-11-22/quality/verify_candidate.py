"""Candidate vs base image (addresses-20261122): every file of the two filesystems.
Outside WARDEN folders, only the four HISTOR depth-rule modules may differ."""
import hashlib, io, json, subprocess, sys, tarfile
PROD = "sha256:c44951f59d00dd8d0a13d2d5d12093a945526d0e70a193b1e49c51d2a1959f90"
CAND = sys.argv[1]
ALLOWED = {
    "app/histor/untrusted.py",
    "app/histor/mcpclient.py",
    "app/histor/subject.py",
    "app/histor/app.py",
}
def export(image):
    cid = subprocess.check_output(["docker", "create", "--network", "none", image], text=True).strip()
    try:
        raw = subprocess.run(["docker", "export", cid], capture_output=True, check=True).stdout
    finally:
        subprocess.run(["docker", "rm", "-v", cid], capture_output=True)
    files = {}
    with tarfile.open(fileobj=io.BytesIO(raw)) as t:
        for m in t.getmembers():
            if m.isfile():
                files[m.name] = t.extractfile(m).read()
    return files
p, c = export(PROD), export(CAND)
W = ("app/scanner/node_modules/@aimarket/warden/", "opt/warden-source/src/")
def outside(names):
    return sorted(n for n in names if not n.startswith(W) and n not in ALLOWED)
only_p, only_c = outside(set(p) - set(c)), outside(set(c) - set(p))
differ = outside(k for k in set(p) & set(c) if p[k] != c[k])
print("files prod", len(p), "candidate", len(c))
print("outside WARDEN+ALLOWED: only prod", only_p[:10], "only candidate", only_c[:10], "differ", differ[:10])
if only_p or only_c or differ:
    raise SystemExit("unexpected filesystem delta outside WARDEN and the four HISTOR files")
for name in sorted(ALLOWED):
    print(name, "changed" if p.get(name) != c.get(name) else "SAME", "sha", hashlib.sha256(c[name]).hexdigest()[:16])
h = hashlib.sha256()
dist = sorted(n for n in c if n.startswith(W[0] + "dist/") and n.count("/") == 6 and n.endswith(".js"))
for n in dist:
    h.update(n.rsplit("/", 1)[1].encode() + b"\0" + c[n] + b"\0")
pkg = json.loads(c[W[0] + "package.json"])
print("candidate warden", pkg["version"], "dist js", len(dist), "buildDigest", h.hexdigest())
print("source files", sum(1 for n in c if n.startswith(W[1])))
