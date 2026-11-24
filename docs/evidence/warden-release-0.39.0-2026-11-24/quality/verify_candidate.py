"""Candidate vs shortlinks base: only WARDEN paths may differ."""
import hashlib, io, json, subprocess, sys, tarfile
PROD = "sha256:2c44c3dfb004fe3b58adcb82dea58dae6a9c29f04065114ad4fa9f25a3c33ed3"
CAND = sys.argv[1]
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
def outside(names): return sorted(n for n in names if not n.startswith(W))
only_p, only_c = outside(set(p) - set(c)), outside(set(c) - set(p))
differ = outside(k for k in set(p) & set(c) if p[k] != c[k])
print("files prod", len(p), "candidate", len(c))
print("outside WARDEN: only prod", only_p[:10], "only candidate", only_c[:10], "differ", differ[:10])
if only_p or only_c or differ:
    raise SystemExit("unexpected filesystem delta outside WARDEN")
h = hashlib.sha256()
dist = sorted(n for n in c if n.startswith(W[0] + "dist/") and n.count("/") == 6 and n.endswith(".js"))
for n in dist:
    h.update(n.rsplit("/", 1)[1].encode() + b"\0" + c[n] + b"\0")
pkg = json.loads(c[W[0] + "package.json"])
print("candidate warden", pkg["version"], "dist js", len(dist), "buildDigest", h.hexdigest())
print("source files", sum(1 for n in c if n.startswith(W[1])))
want = "18221b0084f1f800d0ef916b9613d0ebfd61853d35b1726cc05106ab03c88c0c"
if h.hexdigest() != want:
    raise SystemExit(f"buildDigest mismatch want {want}")
