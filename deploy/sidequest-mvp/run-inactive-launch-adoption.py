#!/usr/bin/env python3
"""Execute the explicitly approved five-host inactive launch adoption once.

This controller never starts, stops, enables or disables a service. It stages
digest-pinned public/release bytes, commits create-once release files and
retained replacements, performs only the exact Comet ownership handoff, and
reloads systemd. Any failure preserves partial state and stops without retry.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
PLAN = HERE / "inactive-launch-adoption-plan-20261103.json"
DECISIONS = HERE / "runtime-decisions-actual-20261103.json"
RENDERER = HERE / "render-runtime-config.py"
PLAN_SHA256 = "b991b64a706ff771572111af71d93550aee20ec6f9545893e7733fc3891d5888"
AGENT = Path("/tmp/ssh-1UGv8p0CgFNJ/agent.263905")
AGENT_FINGERPRINT = "SHA256:IGu9dXOSXw4JoPmwNjAgDRI2AY+zJil/haJGjKRYt34"
STAGE = "/var/lib/plebeian-auctions-friday/separated-inputs/.sidequest-mvp-r4-inactive-adoption-b991b64a"

HOSTS = [
    {"role": "APP", "slot": 0, "ip": "139.162.161.233", "known": "/home/maximoto/Documents/Codex/2026-10-28/task-4/app-https-fresh-guest-read-r2/known-hosts/APP", "knownSha256": "8894056c53a52d1b8c8ebc4941830530edebf9fd2b8a41e4baab7215a4c16dd7"},
    {"role": "V1", "slot": 1, "ip": "172.105.64.142", "known": "/home/maximoto/Documents/Codex/2026-10-28/task-4/remaining-fifteen-fips-probes-r2-socket/known-hosts/V1", "knownSha256": "2c02b18dce28d3efc5923417cd81aa8d3bf5816ee132ea3958e4c8e9be8cb93c"},
    {"role": "V2", "slot": 2, "ip": "172.105.95.57", "known": "/home/maximoto/Documents/Codex/2026-10-28/task-4/remaining-fifteen-fips-probes-r2-socket/known-hosts/V2", "knownSha256": "bdd69b89887b8bbfc4d7b32f0100ded8d0ea4ba9ec9ba54fbdb70925c80bf963"},
    {"role": "V3", "slot": 3, "ip": "172.104.240.217", "known": "/home/maximoto/Documents/Codex/2026-10-28/task-4/remaining-fifteen-fips-probes-r2-socket/known-hosts/V3", "knownSha256": "bc671e31f609abff503df12c6a7afc140ba74a9a814a4832c7189b3d9aa4eb5d"},
    {"role": "V4", "slot": 4, "ip": "172.104.253.247", "known": "/home/maximoto/Documents/Codex/2026-10-28/task-4/remaining-fifteen-fips-probes-r2-socket/known-hosts/V4", "knownSha256": "59f614c0f35f8158f052aa430c789daf7055983eb61aac1d4828b674add213c3"},
]

COMMON_PUBLIC = {
    "comet-genesis-bundle.json": (2741, "e2ec78c285ca98233bef227379acaf9ef2d6f46c543140289803e9d2b954d383"),
    "deployment-anchor.json": (2411, "777e3df52fc4abcff952d27dc7399af99554cba2c4082211f909f5d8c9ecf1eb"),
    "frost-final-public.json": (17321, "f16c7bf8eebf7ce29878f9e2a34c21c8974ad3bdef3372c364657dc7ee061877"),
    "funding-abort-bootstrap.json": (442, "ee4e7fbf23f9e66731b1d908979875aac3fbeec9c1fa54f0a9ae5fa507e2f2cf"),
    "genesis.json": (1876, "8574fadb77fafea9c56fff7cff32af0205be7b2e05d12f1ab1fcf4a1a8f3a4ea"),
    "network-facts.json": (417, "0dd62cc5270f9e007851ed5c892a7386e2cdf620f8b7e1958fe84019ebe594a5"),
    "network.json": (3716, "0fe06ef2c15fd7f0ecd5eed32ac26111f32357c9139ab6c083e88f5ff29b0203"),
    "separated-runtime-binding.json": (17716, "b3e2632ddd5f2b4601b7b91ac9880ce9274767cfeff5c8b5b80aabdd79e9551a"),
    "validator-roster.json": (4685, "e9d68caccf10cc9d1642f736aff87836127c9f5554d21d74d4ec4c6e1f40d22e"),
}
VALIDATOR_PUBLIC = {
    "V1": {"validator-public.json": (1128, "8f8d511a2c65d22c5898f04c1742fad553a3c086980afabab4a4161e0dc836eb"), "validator-final-ack.json": (947, "b991efd5f40bd893991128087e2045d01aaceabd4b8cdbc58943e5c4f97f7fd6")},
    "V2": {"validator-public.json": (1126, "17ed5ee9d3df3d5b0136506b57d163b3a207023d7dc00dc36152ada2409cc1f9"), "validator-final-ack.json": (947, "151ec49fea9ff870f23a5770b2a7b63a6e0222092d8b724bec6efda8133820d8")},
    "V3": {"validator-public.json": (1128, "70e0e289e345e77f9862d552c0b863309f757345ac893e58c853ff8578ea68cb"), "validator-final-ack.json": (947, "12b8a692f5a62c71385ddff415bf615ebcd612493712b162d831b8f57bfaddce")},
    "V4": {"validator-public.json": (1128, "afdb477edfad96428d5f4e46a5646494ac4d553305d9001f5d53a0b9bb95c079"), "validator-final-ack.json": (947, "fc545ad131274e3d26d548163eef1b3cc9ff7ec28cc11b6385b53d1baf3508af")},
}


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def record(path: Path) -> dict:
    before = path.lstat()
    require(path.is_file() and not path.is_symlink() and before.st_nlink == 1, "LOCAL_SOURCE_POLICY:" + str(path))
    raw = path.read_bytes()
    after = path.lstat()
    require((before.st_dev, before.st_ino, before.st_mode, before.st_size, before.st_mtime_ns, before.st_ctime_ns, before.st_nlink) ==
            (after.st_dev, after.st_ino, after.st_mode, after.st_size, after.st_mtime_ns, after.st_ctime_ns, after.st_nlink), "LOCAL_SOURCE_CHANGED:" + str(path))
    return {"path": str(path), "bytes": len(raw), "sha256": sha(raw)}


def ssh_base(host: dict) -> list[str]:
    return [
        "/usr/bin/ssh", "-T", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
        "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=" + host["known"],
        "-o", "GlobalKnownHostsFile=/dev/null", "-o", "PasswordAuthentication=no",
        "-o", "KbdInteractiveAuthentication=no", "-o", "ForwardAgent=no",
        "-o", "ClearAllForwardings=yes", "-o", "ConnectTimeout=12",
        "-o", "ConnectionAttempts=1", "root@" + host["ip"],
    ]


REMOTE = r'''
import ctypes,hashlib,json,os,pwd,grp,shutil,stat,subprocess,sys,time
from pathlib import Path

PLAN="b991b64a706ff771572111af71d93550aee20ec6f9545893e7733fc3891d5888"
STATE=Path("/var/lib/plebeian-auctions-friday")
NETWORK=STATE/"network-separated"
CONFIG=Path("/etc/plebeian-auctions-friday")
RELEASES=Path("/opt/plebeian-auctions-friday/releases")
FINAL=RELEASES/"sidequest-mvp-r4"
INCOMING=RELEASES/".sidequest-mvp-r4.incoming"
STAGE=STATE/"separated-inputs/.sidequest-mvp-r4-inactive-adoption-b991b64a"
PUBLIC_GID=988
CORE_UID=999

class Stop(Exception):pass
def req(v,c):
 if not v:raise Stop(c)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def raw_record(path,limit=150000000):
 path=Path(path);fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  before=os.fstat(fd);req(stat.S_ISREG(before.st_mode) and before.st_nlink==1,"UNSAFE_FILE:"+str(path));req(before.st_size<=limit,"TOO_LARGE:"+str(path))
  value=hashlib.sha256();total=0
  while True:
   block=os.read(fd,min(1048576,limit+1-total))
   if not block:break
   total+=len(block);req(total<=limit,"TOO_LARGE:"+str(path));value.update(block)
  after=os.fstat(fd);fields=lambda x:(x.st_dev,x.st_ino,x.st_mode,x.st_size,x.st_mtime_ns,x.st_ctime_ns,x.st_nlink)
  req(fields(before)==fields(after),"FILE_CHANGED:"+str(path))
  return {"path":str(path),"bytes":total,"sha256":value.hexdigest(),"mode":f"{stat.S_IMODE(before.st_mode):04o}","uid":before.st_uid,"gid":before.st_gid,"nlink":before.st_nlink}
 finally:os.close(fd)
def meta(path):
 path=Path(path)
 try:s=path.lstat()
 except FileNotFoundError:return {"path":str(path),"exists":False}
 return {"path":str(path),"exists":True,"type":"dir" if stat.S_ISDIR(s.st_mode) else "file" if stat.S_ISREG(s.st_mode) else "other","mode":f"{stat.S_IMODE(s.st_mode):04o}","uid":s.st_uid,"gid":s.st_gid,"bytes":s.st_size,"nlink":s.st_nlink}
def exact_dir(path,mode,uid,gid):
 value=Path(path).lstat();req(stat.S_ISDIR(value.st_mode) and not Path(path).is_symlink() and stat.S_IMODE(value.st_mode)==mode and value.st_uid==uid and value.st_gid==gid,"DIRECTORY_METADATA:"+str(path))
def service(name):
 p=subprocess.run(["/usr/bin/systemctl","show",name,"--property=LoadState,ActiveState,SubState,UnitFileState","--no-pager"],text=True,capture_output=True,timeout=10)
 req(p.returncode==0,"SYSTEMD_SHOW:"+name);return {k:v for k,v in (line.split("=",1) for line in p.stdout.splitlines() if "=" in line)}
def services(payload):
 names=payload["services"]
 values={name:service(name) for name in names}
 for name,state in values.items():
  wanted="active" if name in payload["activeServices"] else "inactive"
  req(state.get("ActiveState")==wanted,"SERVICE_STATE:"+name)
 if "plebeian-friday-fips.service" in values:req(values["plebeian-friday-fips.service"].get("SubState")=="running","FIPS_SUBSTATE")
 jobs=subprocess.run(["/usr/bin/systemctl","list-jobs","--all","--no-legend","--no-pager"],text=True,capture_output=True,timeout=10)
 req(jobs.returncode==0,"SYSTEMD_JOBS")
 for name in names:req(name not in jobs.stdout,"SERVICE_JOB:"+name)
 return values
def private_metadata(payload):
 role=payload["role"];slot=payload["slot"]
 if role=="APP":
  root=NETWORK/"observer";expected={"config","data"};req(root.is_dir() and not root.is_symlink(),"OBSERVER_ROOT")
  req({p.name for p in root.iterdir()}==expected,"OBSERVER_ENTRIES")
  req({p.name for p in (root/"config").iterdir()}=={"node_key.json"},"OBSERVER_CONFIG_ENTRIES")
  req({p.name for p in (root/"data").iterdir()}==set(),"OBSERVER_DATA_ENTRIES")
  values=[meta(root),meta(root/"config"),meta(root/"data"),meta(root/"config/node_key.json")]
  req(values[-1]["type"]=="file" and values[-1]["bytes"]==148,"OBSERVER_KEY_METADATA")
 else:
  root=NETWORK/f"validator-{slot}";req(root.is_dir() and not root.is_symlink(),"VALIDATOR_ROOT")
  req({p.name for p in root.iterdir()}=={"config","data"},"VALIDATOR_ENTRIES")
  req({p.name for p in (root/"config").iterdir()}=={"node_key.json","priv_validator_key.json"},"VALIDATOR_CONFIG_ENTRIES")
  req({p.name for p in (root/"data").iterdir()}=={"priv_validator_state.json"},"VALIDATOR_DATA_ENTRIES")
  values=[meta(root),meta(root/"config"),meta(root/"data"),meta(root/"config/node_key.json"),meta(root/"config/priv_validator_key.json"),meta(root/"data/priv_validator_state.json")]
  req([v["bytes"] for v in values[3:]]==[168,345,46] and all(v["type"]=="file" for v in values[3:]),"VALIDATOR_PRIVATE_METADATA")
 req(all(v["uid"]==0 and v["gid"]==0 and v["mode"]=="0700" for v in values[:3]),"PRIVATE_DIRECTORY_PRE_HANDOFF")
 req(all(v["uid"]==0 and v["gid"]==0 and v["mode"]=="0600" for v in values[3:]),"PRIVATE_FILE_PRE_HANDOFF")
 return values
def public_network(payload):
 expected=payload["publicNetwork"]
 private="observer" if payload["role"]=="APP" else f"validator-{payload['slot']}"
 req(NETWORK.is_dir() and not NETWORK.is_symlink(),"NETWORK_ROOT")
 req({p.name for p in NETWORK.iterdir()}==set(expected)|{private},"NETWORK_ENTRIES")
 records={}
 for name,value in expected.items():
  actual=raw_record(NETWORK/name,2000000)
  req(actual["bytes"]==value["bytes"] and actual["sha256"]==value["sha256"] and actual["uid"]==0 and actual["gid"]==0 and actual["mode"] in {"0600","0644"},"PUBLIC_NETWORK:"+name);records[name]=actual
 return records
def config_before(payload):
 result={}
 for name in ("application.json","friday.env"):
  value=raw_record(CONFIG/name,1048576);req(value["uid"]==0 and value["gid"]==PUBLIC_GID and value["mode"]=="0640","CONFIG_METADATA:"+name);result[name]=value
 return result
def verify_units(payload):
 result={}
 for item in payload["units"]:
  value=raw_record(item["path"],1048576);req(value["bytes"]==item["predecessorBytes"] and value["sha256"]==item["predecessorSha256"] and value["uid"]==0 and value["gid"]==0 and value["mode"]=="0644","PREDECESSOR_UNIT:"+item["name"]);result[item["name"]]=value
  req(not Path(item["retained"]).exists() and not Path(item["retained"]).is_symlink() and not Path(item["incoming"]).exists() and not Path(item["incoming"]).is_symlink(),"UNIT_CONTROL_SLOT:"+item["name"])
 return result
def verify_dropins(payload):
 result={}
 for item in payload["dropIns"]:
  value=raw_record(item["path"],1048576);req(value["uid"]==0 and value["gid"]==0 and value["mode"]=="0644","DROPIN_METADATA:"+item["path"])
  raw=Path(item["path"]).read_text();req(raw==item["text"],"DROPIN_TEXT:"+item["path"]);result[item["path"]]=value
 return result
def preconditions(payload,stage_should_exist):
 req(payload["planSha256"]==PLAN,"PLAN_BINDING");req(payload["role"] in {"APP","V1","V2","V3","V4"},"ROLE")
 core=pwd.getpwnam("plebeian-friday");public=grp.getgrnam("plebeian-friday-public");req(core.pw_uid==CORE_UID and core.pw_gid==PUBLIC_GID and public.gr_gid==PUBLIC_GID,"CORE_ACCOUNT")
 if payload["role"]=="APP":
  site=pwd.getpwnam("plebeian-friday-site");mint=pwd.getpwnam("plebeian-friday-mint");req(site.pw_uid==997 and site.pw_gid==PUBLIC_GID and mint.pw_uid==995 and mint.pw_gid==PUBLIC_GID,"APP_ACCOUNTS")
 for executable in ("/usr/bin/systemctl","/usr/bin/systemd-analyze","/usr/sbin/runuser"):
  value=Path(executable).lstat();req(stat.S_ISREG(value.st_mode) and not Path(executable).is_symlink() and value.st_uid==0 and stat.S_IMODE(value.st_mode)&0o111,"SYSTEM_EXECUTABLE:"+executable)
 usage=shutil.disk_usage(STATE);req(usage.free>=4294967296,"FREE_SPACE")
 exact_dir(STATE,0o750,0,PUBLIC_GID);exact_dir(STATE/"separated-inputs",0o750,0,PUBLIC_GID);exact_dir(CONFIG,0o750,0,PUBLIC_GID);exact_dir(RELEASES,0o755,0,0)
 net=NETWORK.lstat();req(stat.S_ISDIR(net.st_mode) and not NETWORK.is_symlink() and stat.S_IMODE(net.st_mode)==0o700 and net.st_uid==0 and net.st_gid==0,"NETWORK_PRE_HANDOFF")
 req(not FINAL.exists() and not FINAL.is_symlink() and not INCOMING.exists() and not INCOMING.is_symlink(),"RELEASE_SLOT")
 req((STAGE.is_dir() and not STAGE.is_symlink()) if stage_should_exist else (not STAGE.exists() and not STAGE.is_symlink()),"STAGE_STATE")
 for name in ("browser-r20-pins.json","health-r20-pins.json","sidequest-runtime-bindings.json"):
  req(not (CONFIG/name).exists() and not (CONFIG/name).is_symlink(),"NEW_CONFIG_SLOT:"+name)
 fixed=STATE/"separated-inputs/runtime-binding.json";req(not fixed.exists() and not fixed.is_symlink(),"RUNTIME_BINDING_SLOT")
 canonical=raw_record(NETWORK/"separated-runtime-binding.json",1048576);req(canonical["bytes"]==17716 and canonical["sha256"]=="b3e2632ddd5f2b4601b7b91ac9880ce9274767cfeff5c8b5b80aabdd79e9551a","CANONICAL_RUNTIME_BINDING")
 for item in payload["configs"]:
  req(not Path(item["retained"]).exists() and not Path(item["retained"]).is_symlink() and not Path(item["incoming"]).exists() and not Path(item["incoming"]).is_symlink(),"CONFIG_CONTROL_SLOT:"+item["name"])
 predecessor=raw_record("/opt/plebeian-auctions-friday/releases/separated-deploy-v1/bin/plebeian-auctions-poc");req(predecessor["bytes"]==46580232 and predecessor["sha256"]=="8f501da6c7b054d3b33f98f4be52c0299655fc52756af70cd59cbc5740afd7c4" and predecessor["uid"]==0 and predecessor["mode"]=="0755","PREDECESSOR_NODE_BINARY")
 values={"services":services(payload),"privateMetadataOnly":private_metadata(payload),"publicNetwork":public_network(payload),"configBefore":config_before(payload),"unitsBefore":verify_units(payload),"dropIns":verify_dropins(payload),"canonicalRuntimeBinding":canonical,"freeBytes":usage.free}
 if "expectedConfigBefore" in payload:
  for name,expected in payload["expectedConfigBefore"].items():
   actual=values["configBefore"][name];req(actual["bytes"]==expected["bytes"] and actual["sha256"]==expected["sha256"],"CONFIG_CHANGED_AFTER_PREFLIGHT:"+name)
 return values
def write_create(source,destination,mode,uid,gid):
 source=Path(source);destination=Path(destination);sfd=os.open(source,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC);dfd=-1
 try:
  before=os.fstat(sfd);req(stat.S_ISREG(before.st_mode) and before.st_nlink==1,"COPY_SOURCE:"+str(source));dfd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,mode)
  while True:
   block=os.read(sfd,1048576)
   if not block:break
   view=memoryview(block)
   while view:
    count=os.write(dfd,view);req(count>0,"COPY_WRITE:"+str(destination));view=view[count:]
  after=os.fstat(sfd);fields=lambda x:(x.st_dev,x.st_ino,x.st_mode,x.st_size,x.st_mtime_ns,x.st_ctime_ns,x.st_nlink);req(fields(before)==fields(after),"COPY_SOURCE_CHANGED:"+str(source))
  os.fchmod(dfd,mode);os.fchown(dfd,uid,gid);os.fsync(dfd)
 finally:
  if dfd>=0:os.close(dfd)
  os.close(sfd)
 return raw_record(destination)
def fsync_dir(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:os.fsync(fd)
 finally:os.close(fd)
def rename_no_replace(source,destination):
 libc=ctypes.CDLL(None,use_errno=True);function=getattr(libc,"renameat2",None);req(function is not None,"RENAMEAT2_UNAVAILABLE")
 result=function(-100,os.fsencode(source),-100,os.fsencode(destination),1)
 if result!=0:
  error=ctypes.get_errno();raise OSError(error,os.strerror(error),str(source),str(destination))
def replace_retained(source,current,retained,incoming,mode,uid,gid,expected):
 now=raw_record(current,1048576);req(now["bytes"]==expected["bytes"] and now["sha256"]==expected["sha256"],"REPLACEMENT_SOURCE_CHANGED:"+str(current))
 write_create(current,retained,mode,uid,gid);write_create(source,incoming,mode,uid,gid);os.replace(incoming,current);fsync_dir(Path(current).parent)
def append_journal(fd,event,**fields):
 raw=(json.dumps({"event":event,"timeNs":time.time_ns(),**fields},sort_keys=True,separators=(",",":"))+"\n").encode();os.write(fd,raw);os.fsync(fd)
def set_exact(path,mode,uid,gid,kind):
 path=Path(path);value=path.lstat();req(not path.is_symlink() and ((kind=="dir" and stat.S_ISDIR(value.st_mode)) or (kind=="file" and stat.S_ISREG(value.st_mode))),"HANDOFF_TYPE:"+str(path));os.chown(path,uid,gid,follow_symlinks=False);os.chmod(path,mode)
def run_guard(user,argv):
 p=subprocess.run(["/usr/sbin/runuser","-u",user,"-g","plebeian-friday-public","--",*argv],text=True,capture_output=True,timeout=60)
 req(p.returncode==0,"GUARD_FAILED:"+user+":"+p.stdout[:1000]+p.stderr[:1000]);return p.stdout.strip()

raw=sys.stdin.buffer.read(2000000);req(len(raw)<2000000,"PAYLOAD_TOO_LARGE");payload=json.loads(raw);phase=payload["phase"]
try:
 if phase=="preflight":
  values=preconditions(payload,False);print(json.dumps({"schema":"PLEBEIAN_SIDEQUEST_INACTIVE_ADOPTION_REMOTE_V1","status":"PREFLIGHT_PASS","role":payload["role"],**values},sort_keys=True,separators=(",",":")))
 elif phase=="prepare":
  values=preconditions(payload,False);os.mkdir(STAGE,0o700);os.chown(STAGE,0,0);fsync_dir(STAGE.parent);print(json.dumps({"schema":"PLEBEIAN_SIDEQUEST_INACTIVE_ADOPTION_REMOTE_V1","status":"STAGE_CREATED","role":payload["role"],"stage":str(STAGE),"configBefore":values["configBefore"]},sort_keys=True,separators=(",",":")))
 elif phase=="finalize":
  values=preconditions(payload,True)
  expected={item["stageName"]:item for item in payload["stageFiles"]};req({p.name for p in STAGE.iterdir()}==set(expected),"STAGE_ENTRIES")
  staged={}
  for name,item in expected.items():
   value=raw_record(STAGE/name);req(value["bytes"]==item["bytes"] and value["sha256"]==item["sha256"] and value["uid"]==0,"STAGE_FILE:"+name);staged[name]=value
  journal_path=STAGE/"JOURNAL.jsonl";jfd=os.open(journal_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
  try:
   append_journal(jfd,"PREFLIGHT_RECHECK_PASS",configBefore=values["configBefore"])
   os.mkdir(INCOMING,0o755);os.mkdir(INCOMING/"bin",0o755)
   release_records={}
   for item in payload["releaseFiles"]:release_records[item["destination"]]=write_create(STAGE/item["stageName"],INCOMING/item["destination"],0o755,0,0)
   fsync_dir(INCOMING/"bin");fsync_dir(INCOMING);rename_no_replace(INCOMING,FINAL);fsync_dir(RELEASES);append_journal(jfd,"RELEASE_PUBLISHED",files=release_records)
   fixed=STATE/"separated-inputs/runtime-binding.json";runtime_record=write_create(NETWORK/"separated-runtime-binding.json",fixed,0o640,0,PUBLIC_GID)
   pins={}
   for item in payload["newConfigs"]:pins[item["name"]]=write_create(STAGE/item["stageName"],item["path"],0o640,0,PUBLIC_GID)
   config_after={}
   for item in payload["configs"]:
    expected=payload["expectedConfigBefore"][item["name"]];replace_retained(STAGE/item["stageName"],item["path"],item["retained"],item["incoming"],0o640,0,PUBLIC_GID,expected);config_after[item["name"]]=raw_record(item["path"],1048576)
   append_journal(jfd,"CONFIG_INSTALLED",runtimeBinding=runtime_record,newFiles=pins,replacements=config_after)
   unit_after={}
   for item in payload["units"]:
    expected={"bytes":item["predecessorBytes"],"sha256":item["predecessorSha256"]};replace_retained(STAGE/item["stageName"],item["path"],item["retained"],item["incoming"],0o644,0,0,expected);unit_after[item["name"]]=raw_record(item["path"],1048576)
   append_journal(jfd,"UNITS_INSTALLED",units=unit_after)
   set_exact(NETWORK,0o750,0,PUBLIC_GID,"dir")
   for name in payload["publicNetwork"]:set_exact(NETWORK/name,0o640,0,PUBLIC_GID,"file")
   slot=payload["slot"]
   if payload["role"]=="APP":
    private_dirs=[NETWORK/"observer",NETWORK/"observer/config",NETWORK/"observer/data"];private_files=[NETWORK/"observer/config/node_key.json"]
   else:
    root=NETWORK/f"validator-{slot}";private_dirs=[root,root/"config",root/"data"];private_files=[root/"config/node_key.json",root/"config/priv_validator_key.json",root/"data/priv_validator_state.json"]
   for path in private_dirs:set_exact(path,0o700,CORE_UID,PUBLIC_GID,"dir")
   for path in private_files:set_exact(path,0o600,CORE_UID,PUBLIC_GID,"file")
   append_journal(jfd,"OWNERSHIP_HANDOFF_COMPLETE",publicRoot=meta(NETWORK),privateMetadataOnly=[meta(v) for v in private_dirs+private_files])
   verify=subprocess.run(["/usr/bin/systemd-analyze","verify",*[item["path"] for item in payload["units"]]],text=True,capture_output=True,timeout=60)
   req(verify.returncode==0,"SYSTEMD_ANALYZE:"+verify.stdout[:1000]+verify.stderr[:1000])
   reload=subprocess.run(["/usr/bin/systemctl","daemon-reload"],text=True,capture_output=True,timeout=30);req(reload.returncode==0,"DAEMON_RELOAD:"+reload.stderr[:1000])
   after_services=services(payload)
   guards=[]
   for item in payload["guards"]:guards.append({"name":item["name"],"stdout":run_guard(item["user"],item["argv"])})
   append_journal(jfd,"POSTCHECK_PASS",services=after_services,guards=guards)
   actual={"schema":"PLEBEIAN_SIDEQUEST_INACTIVE_ADOPTION_HOST_ACTUAL_V1","status":"INACTIVE_ADOPTION_COMPLETE_SERVICES_NOT_STARTED","planSha256":PLAN,"role":payload["role"],"slot":payload["slot"],"releaseRoot":str(FINAL),"releaseFiles":release_records,"runtimeBinding":runtime_record,"newConfigFiles":pins,"configBefore":values["configBefore"],"configAfter":config_after,"unitsBefore":values["unitsBefore"],"unitsAfter":unit_after,"publicNetworkRoot":meta(NETWORK),"privateMetadataOnly":[meta(v) for v in private_dirs+private_files],"services":after_services,"guards":guards,"daemonReloaded":True,"servicesStartedStoppedEnabledDisabledOrRestarted":False,"authorityStateInitialized":False,"privateFileContentsOrHashesRead":False,"credentialsCreated":False,"paymentsPerformed":False,"firewallHttpsOrNginxChanged":False}
   actual_raw=(json.dumps(actual,sort_keys=True,separators=(",",":"))+"\n").encode();afd=os.open(STAGE/"ACTUAL.json",os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600);os.write(afd,actual_raw);os.fsync(afd);os.close(afd);fsync_dir(STAGE);print(actual_raw.decode(),end="")
  finally:os.close(jfd)
 elif phase=="reconcile":
  actual=STAGE/"ACTUAL.json"
  if actual.is_file() and not actual.is_symlink():print(actual.read_text(),end="")
  else:print(json.dumps({"schema":"PLEBEIAN_SIDEQUEST_INACTIVE_ADOPTION_RECONCILE_V1","status":"PARTIAL_OR_UNCERTAIN","role":payload["role"],"stage":meta(STAGE),"release":meta(FINAL),"services":services(payload)},sort_keys=True,separators=(",",":")))
 else:raise Stop("PHASE")
except (Stop,OSError,ValueError,KeyError,TypeError,subprocess.SubprocessError) as error:
 print(json.dumps({"schema":"PLEBEIAN_SIDEQUEST_INACTIVE_ADOPTION_REMOTE_V1","status":"STOPPED_PRESERVE_STATE_NO_RETRY","role":payload.get("role"),"phase":phase,"category":str(error),"stage":meta(STAGE),"release":meta(FINAL)},sort_keys=True,separators=(",",":")))
 raise SystemExit(1)
'''


def remote(host: dict, payload: dict, timeout: int = 90) -> subprocess.CompletedProcess[bytes]:
    command = ssh_base(host) + [" ".join(shlex.quote(value) for value in ["/usr/bin/python3", "-c", REMOTE])]
    return subprocess.run(command, input=(json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n").encode(), env=ENV, capture_output=True, timeout=timeout)


def parse_remote(process: subprocess.CompletedProcess[bytes], category: str) -> dict:
    if process.returncode != 0:
        raise Stop(category + ":returncode=" + str(process.returncode) + ":stdout=" + process.stdout.decode("utf-8", "replace")[:4000] + ":stderr=" + process.stderr.decode("utf-8", "replace")[:4000])
    try:
        return json.loads(process.stdout)
    except Exception as error:
        raise Stop(category + ":invalid-json:" + type(error).__name__) from error


def local_sources(host: dict, config_root: Path) -> tuple[list[Path], dict]:
    role = host["role"]
    support = [
        REPO / "deploy/sidequest-mvp/verify-sidequest-role-target.py",
        REPO / "deploy/friday/separated/verify-friday-separated-target.py",
        REPO / "deploy/friday/verify-friday-runtime-target.py",
    ]
    if role == "APP":
        release = [
            REPO / "dist/sidequest/plebeian-auctions-mvp",
            REPO / "dist/sidequest/plebeian-friday-authority",
            REPO / "dist/sidequest/plebeian-friday-coordinator",
            REPO / "dist/sidequest/plebeian-friday-terminal-executor",
            REPO / "deploy/sidequest-mvp/verify-successor-runtime.py",
            *support,
        ]
        units = [
            REPO / "deploy/sidequest-mvp/plebeian-friday-site-successor.service",
            REPO / "deploy/sidequest-mvp/plebeian-friday-authority-successor.service",
            REPO / "deploy/sidequest-mvp/plebeian-friday-coordinator-successor.service",
        ]
    else:
        release = [REPO / "dist/sidequest/plebeian-friday-signer", *support]
        units = [REPO / "deploy/sidequest-mvp/plebeian-friday-signer-successor.service"]
    configs = [config_root / role / "application.json", config_root / role / "friday.env"]
    if role == "APP":
        configs.append(config_root / role / "sidequest-runtime-bindings.json")
    common = [
        REPO / "deploy/sidequest-mvp/launch-preparation-r1/browser-r20-pins.json",
        REPO / "deploy/sidequest-mvp/launch-preparation-r1/health-r20-pins.json",
    ]
    sources = release + units + configs + common
    names = [path.name for path in sources]
    require(len(names) == len(set(names)), "LOCAL_STAGE_BASENAME_COLLISION:" + role)
    return sources, {path.name: record(path) for path in sources}


def validate_local_sources(host: dict, records: dict, plan: dict) -> None:
    role = host["role"]
    expected: dict[str, tuple[int, str]] = {}
    app_artifacts = {value["name"]: value for value in plan["release"]["appArtifacts"]}
    validator_artifacts = {value["name"]: value for value in plan["release"]["validatorArtifacts"]}
    support = {value["name"]: value for value in plan["release"]["allRoleSupportArtifacts"]}
    if role == "APP":
        for name in ("plebeian-auctions-mvp", "plebeian-friday-authority", "plebeian-friday-coordinator", "plebeian-friday-terminal-executor"):
            value = app_artifacts[name]
            expected[name] = (value["bytes"], value["sha256"])
        value = app_artifacts["verify-sidequest-runtime.py"]
        expected["verify-successor-runtime.py"] = (value["bytes"], value["sha256"])
        unit_source = {
            "plebeian-friday-site.service": "plebeian-friday-site-successor.service",
            "plebeian-friday-authority.service": "plebeian-friday-authority-successor.service",
            "plebeian-friday-coordinator.service": "plebeian-friday-coordinator-successor.service",
        }
        for value in plan["units"]["app"]:
            expected[unit_source[value["name"]]] = (value["successorBytes"], value["successorSha256"])
    else:
        value = validator_artifacts["plebeian-friday-signer"]
        expected["plebeian-friday-signer"] = (value["bytes"], value["sha256"])
        value = plan["units"]["validators"][0]
        expected["plebeian-friday-signer-successor.service"] = (value["successorBytes"], value["successorSha256"])
    support_sources = {
        "verify-friday-separated-target.py": "verify-sidequest-role-target.py",
        "verify-friday-separated-base.py": "verify-friday-separated-target.py",
        "verify-friday-runtime-target.py": "verify-friday-runtime-target.py",
    }
    for installed, source in support_sources.items():
        value = support[installed]
        expected[source] = (value["bytes"], value["sha256"])
    config = plan["configuration"]["postApprovalInactiveFiles"][role]
    for name, value in config.items():
        expected[name] = (value["bytes"], value["sha256"])
    for value in plan["configuration"]["sharedPublicFilesOnAllFiveHosts"]:
        name = Path(value["destination"]).name
        if name != "runtime-binding.json":
            expected[name] = (value["bytes"], value["sha256"])
    require(set(records) == set(expected), "LOCAL_SOURCE_SET:" + role)
    for name, (size, digest_value) in expected.items():
        require(records[name]["bytes"] == size and records[name]["sha256"] == digest_value, "LOCAL_SOURCE_PLAN_BINDING:" + role + ":" + name)


def payload(host: dict, sources: dict) -> dict:
    role = host["role"]
    public = dict(COMMON_PUBLIC)
    if role == "APP":
        public["observer.json"] = (827, "1970b8117cfb293a4f67f837f793b2f1521db4a1aec6ed4ea42b94031f666508")
        units = [
            ("plebeian-friday-site.service", "plebeian-friday-site-successor.service", 1041, "475a8532c4a504c08cd8e5ae48495adaf53a2d4f6ee7cf8dc12d2b82a460f6f4"),
            ("plebeian-friday-authority.service", "plebeian-friday-authority-successor.service", 1824, "83012ab70ca09f773b35c3fe38554ccd98a45bbcdaa2920682201a2ba533bfeb"),
            ("plebeian-friday-coordinator.service", "plebeian-friday-coordinator-successor.service", 1603, "3adc409a3ee1d0d38afbf7df8f3a7ce5a82f20367bbf3f8a2d54c3333b583af2"),
        ]
        release = [
            ("plebeian-auctions-mvp", "bin/plebeian-auctions-mvp"),
            ("plebeian-friday-authority", "bin/plebeian-friday-authority"),
            ("plebeian-friday-coordinator", "bin/plebeian-friday-coordinator"),
            ("plebeian-friday-terminal-executor", "bin/plebeian-friday-terminal-executor"),
            ("verify-successor-runtime.py", "bin/verify-sidequest-runtime.py"),
            ("verify-sidequest-role-target.py", "bin/verify-friday-separated-target.py"),
            ("verify-friday-separated-target.py", "bin/verify-friday-separated-base.py"),
            ("verify-friday-runtime-target.py", "bin/verify-friday-runtime-target.py"),
        ]
        service_names = ["plebeian-friday-fips.service", "plebeian-friday-mint.service", "plebeian-friday-observer.service", "plebeian-friday-site.service", "plebeian-friday-authority.service", "plebeian-friday-coordinator.service"]
        active = ["plebeian-friday-fips.service", "plebeian-friday-mint.service"]
        guards = [
            {"name": "observer", "user": "plebeian-friday", "argv": ["/usr/bin/python3", "-I", "-S", "-B", "/opt/plebeian-auctions-friday/releases/separated-deploy-v1/bin/verify-friday-separated-target.py", "--environment", "/etc/plebeian-auctions-friday/friday.env", "--application", "/etc/plebeian-auctions-friday/application.json", "--service", "plebeian-friday-observer.service"]},
            {"name": "site", "user": "plebeian-friday-site", "argv": ["/usr/bin/python3", "-I", "-S", "-B", "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4/bin/verify-friday-separated-target.py", "--environment", "/etc/plebeian-auctions-friday/friday.env", "--application", "/etc/plebeian-auctions-friday/application.json", "--service", "plebeian-friday-site.service"]},
            {"name": "authority", "user": "plebeian-friday", "argv": ["/usr/bin/python3", "-I", "-S", "-B", "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4/bin/verify-friday-separated-target.py", "--environment", "/etc/plebeian-auctions-friday/friday.env", "--application", "/etc/plebeian-auctions-friday/application.json", "--service", "plebeian-friday-authority.service"]},
            {"name": "coordinator", "user": "plebeian-friday", "argv": ["/usr/bin/python3", "-I", "-S", "-B", "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4/bin/verify-friday-separated-target.py", "--environment", "/etc/plebeian-auctions-friday/friday.env", "--application", "/etc/plebeian-auctions-friday/application.json", "--service", "plebeian-friday-coordinator.service"]},
        ]
        drop_ins = []
    else:
        public.update(VALIDATOR_PUBLIC[role]);public["comet-launch.json"] = (4404, "a106c0a408f6f5ae35841fbe3efd416007f7578c1d62f35126b2aadc1655765c")
        units = [("plebeian-friday-signer.service", "plebeian-friday-signer-successor.service", 1509, "ff19937cdc1c1b8b03485adc738eddfee715e57cc5be841c84345194daa47f08")]
        release = [
            ("plebeian-friday-signer", "bin/plebeian-friday-signer"),
            ("verify-sidequest-role-target.py", "bin/verify-friday-separated-target.py"),
            ("verify-friday-separated-target.py", "bin/verify-friday-separated-base.py"),
            ("verify-friday-runtime-target.py", "bin/verify-friday-runtime-target.py"),
        ]
        service_names = ["plebeian-friday-fips.service", "plebeian-friday-validator.service", "plebeian-friday-signer.service"]
        active = ["plebeian-friday-fips.service"]
        guards = [
            {"name": "validator", "user": "plebeian-friday", "argv": ["/usr/bin/python3", "-I", "-S", "-B", "/opt/plebeian-auctions-friday/releases/separated-deploy-v1/bin/verify-friday-separated-target.py", "--environment", "/etc/plebeian-auctions-friday/friday.env", "--application", "/etc/plebeian-auctions-friday/application.json", "--service", "plebeian-friday-validator.service"]},
            {"name": "signer", "user": "plebeian-friday", "argv": ["/usr/bin/python3", "-I", "-S", "-B", "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4/bin/verify-friday-separated-target.py", "--environment", "/etc/plebeian-auctions-friday/friday.env", "--application", "/etc/plebeian-auctions-friday/application.json", "--service", "plebeian-friday-signer.service"]},
        ]
        drop_ins = [
            {"path": "/etc/systemd/system/plebeian-friday-validator.service.d/20-separated-state.conf", "text": f"[Service]\nReadWritePaths=\nReadWritePaths=/var/lib/plebeian-auctions-friday/network-separated/validator-{host['slot']}\n"},
            {"path": "/etc/systemd/system/plebeian-friday-signer.service.d/20-separated-state.conf", "text": f"[Service]\nReadWritePaths=\nReadWritePaths=/var/lib/plebeian-auctions-friday/frost-v3/keyset-v3 /var/lib/plebeian-auctions-friday/separated/node-{host['slot']}\n"},
        ]
    unit_records = []
    for name, stage_name, predecessor_bytes, predecessor_sha in units:
        unit_records.append({"name": name, "stageName": stage_name, "path": "/etc/systemd/system/" + name, "retained": "/etc/systemd/system/." + name.removesuffix(".service") + ".pre-sidequest-mvp-r4.service", "incoming": "/etc/systemd/system/." + name.removesuffix(".service") + ".sidequest-mvp-r4-incoming.service", "predecessorBytes": predecessor_bytes, "predecessorSha256": predecessor_sha})
    release_files = [{"stageName": name, "destination": destination} for name, destination in release]
    config_records = [
        {"name": "application.json", "stageName": "application.json", "path": "/etc/plebeian-auctions-friday/application.json", "retained": "/etc/plebeian-auctions-friday/.application.pre-sidequest-mvp-r4.json", "incoming": "/etc/plebeian-auctions-friday/.application.sidequest-mvp-r4-incoming.json"},
        {"name": "friday.env", "stageName": "friday.env", "path": "/etc/plebeian-auctions-friday/friday.env", "retained": "/etc/plebeian-auctions-friday/.friday.pre-sidequest-mvp-r4.env", "incoming": "/etc/plebeian-auctions-friday/.friday.sidequest-mvp-r4-incoming.env"},
    ]
    new_configs = [
        {"name": "browser-r20-pins.json", "stageName": "browser-r20-pins.json", "path": "/etc/plebeian-auctions-friday/browser-r20-pins.json"},
        {"name": "health-r20-pins.json", "stageName": "health-r20-pins.json", "path": "/etc/plebeian-auctions-friday/health-r20-pins.json"},
    ]
    if role == "APP":
        new_configs.append({"name": "sidequest-runtime-bindings.json", "stageName": "sidequest-runtime-bindings.json", "path": "/etc/plebeian-auctions-friday/sidequest-runtime-bindings.json"})
    return {
        "planSha256": PLAN_SHA256, "role": role, "slot": host["slot"], "services": service_names, "activeServices": active,
        "publicNetwork": {name: {"bytes": size, "sha256": value} for name, (size, value) in public.items()},
        "units": unit_records, "releaseFiles": release_files, "configs": config_records, "newConfigs": new_configs, "guards": guards, "dropIns": drop_ins,
        "stageFiles": [{"stageName": name, "bytes": value["bytes"], "sha256": value["sha256"]} for name, value in sorted(sources.items())],
    }


def stage(host: dict, sources: list[Path]) -> None:
    command = [
        "/usr/bin/scp", "-q", "-p", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
        "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=" + host["known"],
        "-o", "GlobalKnownHostsFile=/dev/null", "-o", "PasswordAuthentication=no",
        "-o", "KbdInteractiveAuthentication=no", "-o", "ForwardAgent=no",
        "-o", "ClearAllForwardings=yes", "-o", "ConnectTimeout=12",
        *[str(path) for path in sources], "root@" + host["ip"] + ":" + STAGE + "/",
    ]
    process = subprocess.run(command, env=ENV, capture_output=True, timeout=600)
    if process.returncode != 0:
        raise Stop("SCP_FAILED_PRESERVE_STAGE:" + host["role"] + ":" + process.stderr.decode("utf-8", "replace")[:4000])


def render_approved_config(root: Path) -> Path:
    decisions = json.loads(DECISIONS.read_text(encoding="utf-8"))
    decisions["status"] = "APPROVED_INACTIVE_INSTALL_PLAN_" + PLAN_SHA256
    decisions["authority"].update({
        "releaseInstallAuthorized": True,
        "unitInstallAuthorized": True,
        "configurationInstallAuthorized": True,
        "serviceActivationAuthorized": False,
    })
    decision_path = root / "approved-decisions.json"
    decision_path.write_text(json.dumps(decisions, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    output = root / "runtime"
    process = subprocess.run(["python3", "-I", "-S", "-B", str(RENDERER), "--plan", str(HERE / "runtime-adoption-plan.json"), "--decisions", str(decision_path), "--output-root", str(output)], text=True, capture_output=True, timeout=60)
    require(process.returncode == 0, "RENDER_FAILED:" + process.stdout + process.stderr)
    result = json.loads(process.stdout)
    require(result["status"] == "READY_FOR_INACTIVE_INSTALL" and result["installAuthorized"] is True and result["activationAuthorized"] is False, "RENDER_AUTHORITY_BOUNDARY")
    return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--approved-plan-sha256", required=True)
    args = parser.parse_args()
    require(args.approved_plan_sha256 == PLAN_SHA256, "APPROVAL_DIGEST")
    require(sha(PLAN.read_bytes()) == PLAN_SHA256, "PLAN_BYTES")
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    require(plan["schema"] == "PLEBEIAN_SIDEQUEST_INACTIVE_LAUNCH_ADOPTION_PLAN_V1", "PLAN_SCHEMA")
    require(AGENT.is_socket(), "SSH_AGENT_SOCKET")
    agent = subprocess.run(["/usr/bin/ssh-add", "-l"], env=ENV, text=True, capture_output=True, timeout=10)
    require(agent.returncode == 0 and AGENT_FINGERPRINT in agent.stdout and len(agent.stdout.splitlines()) == 1, "SSH_AGENT_IDENTITY")
    for host in HOSTS:
        require(sha(Path(host["known"]).read_bytes()) == host["knownSha256"], "KNOWN_HOSTS:" + host["role"])
    results = []
    with tempfile.TemporaryDirectory(prefix="sidequest-approved-inactive-", dir="/tmp") as temporary:
        config_root = render_approved_config(Path(temporary))
        prepared = []
        for host in HOSTS:
            sources, source_records = local_sources(host, config_root)
            validate_local_sources(host, source_records, plan)
            value = payload(host, source_records)
            preflight_payload = {**value, "phase": "preflight"}
            preflight = parse_remote(remote(host, preflight_payload), "PREFLIGHT:" + host["role"])
            require(preflight["status"] == "PREFLIGHT_PASS", "PREFLIGHT_STATUS:" + host["role"])
            expected_before = {name: {"bytes": item["bytes"], "sha256": item["sha256"]} for name, item in preflight["configBefore"].items()}
            value["expectedConfigBefore"] = expected_before
            prepared.append((host, sources, value))
        print(json.dumps({"progress": "ALL_FIVE_PREFLIGHTS_PASS", "roles": [value[0]["role"] for value in prepared]}, sort_keys=True), flush=True)
        for host, sources, value in prepared:
            prepare = parse_remote(remote(host, {**value, "phase": "prepare"}), "PREPARE:" + host["role"])
            require(prepare["status"] == "STAGE_CREATED", "PREPARE_STATUS:" + host["role"])
            stage(host, sources)
            process = remote(host, {**value, "phase": "finalize"}, timeout=180)
            if process.returncode != 0:
                reconciliation = remote(host, {**value, "phase": "reconcile"}, timeout=60)
                raise Stop("FINALIZE_FAILED_NO_RETRY:" + host["role"] + ":stdout=" + process.stdout.decode("utf-8", "replace")[:5000] + ":stderr=" + process.stderr.decode("utf-8", "replace")[:5000] + ":reconcile=" + reconciliation.stdout.decode("utf-8", "replace")[:5000])
            actual = parse_remote(process, "FINALIZE:" + host["role"])
            require(actual["status"] == "INACTIVE_ADOPTION_COMPLETE_SERVICES_NOT_STARTED", "FINALIZE_STATUS:" + host["role"])
            results.append(actual)
            print(json.dumps({"progress": "HOST_COMPLETE", "role": host["role"], "releaseRoot": actual["releaseRoot"], "daemonReloaded": actual["daemonReloaded"]}, sort_keys=True), flush=True)
    print(json.dumps({"schema": "PLEBEIAN_SIDEQUEST_INACTIVE_ADOPTION_FIVE_HOST_ACTUAL_V1", "status": "FIVE_HOST_INACTIVE_ADOPTION_COMPLETE_SERVICES_NOT_STARTED", "planSha256": PLAN_SHA256, "hosts": results, "authorityStateInitialized": False, "servicesStartedStoppedEnabledDisabledOrRestarted": False, "privateFileContentsOrHashesRead": False, "credentialsCreated": False, "paymentsPerformed": False, "firewallHttpsOrNginxChanged": False}, sort_keys=True, separators=(",", ":")))
    return 0


ENV = {"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C", "TZ": "UTC", "SSH_AUTH_SOCK": str(AGENT)}

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop, subprocess.SubprocessError) as error:
        print("INACTIVE_LAUNCH_ADOPTION=STOPPED:" + str(error), file=sys.stderr)
        raise SystemExit(1)
