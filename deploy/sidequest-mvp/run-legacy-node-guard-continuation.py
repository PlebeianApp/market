#!/usr/bin/env python3
"""Continue the stopped inactive adoption with an approved legacy-node guard."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
PLAN = HERE / "legacy-node-guard-continuation-plan-20261103.json"
PLAN_SHA256 = "55123962caca294cdf5c9bd2ddb5981df9695974b113da3f6e424bb0a96d6d91"
BASE_CONTROLLER = HERE / "run-inactive-launch-adoption.py"
GUARD_STAGE = (
    "/var/lib/plebeian-auctions-friday/separated-inputs/"
    ".sidequest-mvp-r4-legacy-node-guard-v1"
)
GUARD_RELEASE = (
    "/opt/plebeian-auctions-friday/releases/"
    "sidequest-mvp-r4-legacy-node-guard-v1"
)
AGENT_FINGERPRINT = "SHA256:IGu9dXOSXw4JoPmwNjAgDRI2AY+zJil/haJGjKRYt34"


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def load_base_controller():
    spec = importlib.util.spec_from_file_location(
        "inactive_launch_adoption_base", BASE_CONTROLLER
    )
    module = importlib.util.module_from_spec(spec)
    require(spec is not None and spec.loader is not None, "BASE_CONTROLLER_SPEC")
    spec.loader.exec_module(module)
    return module


BASE = load_base_controller()
HOSTS = BASE.HOSTS
ENV = BASE.ENV


GUARD_REMOTE = r'''
import ctypes,hashlib,json,os,pwd,grp,stat,subprocess,sys,time
from pathlib import Path

PLAN="55123962caca294cdf5c9bd2ddb5981df9695974b113da3f6e424bb0a96d6d91"
STATE=Path("/var/lib/plebeian-auctions-friday")
RELEASES=Path("/opt/plebeian-auctions-friday/releases")
GUARD=RELEASES/"sidequest-mvp-r4-legacy-node-guard-v1"
INCOMING=RELEASES/".sidequest-mvp-r4-legacy-node-guard-v1.incoming"
STAGE=STATE/"separated-inputs/.sidequest-mvp-r4-legacy-node-guard-v1"
PUBLIC_GID=988
CORE_UID=999

class Stop(Exception):pass
def req(value,category):
 if not value:raise Stop(category)
def raw_record(path,limit=150000000):
 path=Path(path);descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  before=os.fstat(descriptor);req(stat.S_ISREG(before.st_mode) and before.st_nlink==1,"UNSAFE_FILE:"+str(path));req(before.st_size<=limit,"TOO_LARGE:"+str(path));value=hashlib.sha256();total=0
  while True:
   block=os.read(descriptor,min(1048576,limit+1-total))
   if not block:break
   total+=len(block);req(total<=limit,"TOO_LARGE:"+str(path));value.update(block)
  after=os.fstat(descriptor);fields=lambda item:(item.st_dev,item.st_ino,item.st_mode,item.st_size,item.st_mtime_ns,item.st_ctime_ns,item.st_nlink);req(fields(before)==fields(after),"FILE_CHANGED:"+str(path))
  return {"path":str(path),"bytes":total,"sha256":value.hexdigest(),"mode":f"{stat.S_IMODE(before.st_mode):04o}","uid":before.st_uid,"gid":before.st_gid,"nlink":before.st_nlink}
 finally:os.close(descriptor)
def meta(path):
 path=Path(path)
 try:value=path.lstat()
 except FileNotFoundError:return {"path":str(path),"exists":False}
 return {"path":str(path),"exists":True,"type":"dir" if stat.S_ISDIR(value.st_mode) else "file" if stat.S_ISREG(value.st_mode) else "other","mode":f"{stat.S_IMODE(value.st_mode):04o}","uid":value.st_uid,"gid":value.st_gid,"bytes":value.st_size,"nlink":value.st_nlink}
def service(name):
 process=subprocess.run(["/usr/bin/systemctl","show",name,"--property=LoadState,ActiveState,SubState,UnitFileState,FragmentPath","--no-pager"],text=True,capture_output=True,timeout=10);req(process.returncode==0,"SYSTEMD_SHOW:"+name);return {key:value for key,value in (line.split("=",1) for line in process.stdout.splitlines() if "=" in line)}
def services(payload):
 values={name:service(name) for name in payload["services"]}
 for name,value in values.items():
  expected="active" if name in payload["activeServices"] else "inactive";req(value.get("ActiveState")==expected,"SERVICE_STATE:"+name)
 jobs=subprocess.run(["/usr/bin/systemctl","list-jobs","--all","--no-legend","--no-pager"],text=True,capture_output=True,timeout=10);req(jobs.returncode==0,"SYSTEMD_JOBS")
 for name in payload["services"]:req(name not in jobs.stdout,"SERVICE_JOB:"+name)
 return values
def verify_files(items):
 result={}
 for item in items:
  value=raw_record(item["path"]);req(value["bytes"]==item["bytes"] and value["sha256"]==item["sha256"] and value["uid"]==item.get("uid",0) and value["gid"]==item.get("gid",value["gid"]) and value["mode"]==item.get("mode",value["mode"]),"CURRENT_FILE:"+item["path"]);result[item["path"]]=value
 return result
def preconditions(payload,stage_should_exist):
 req(payload["planSha256"]==PLAN,"PLAN_BINDING");req(payload["role"] in {"APP","V1","V2","V3","V4"},"ROLE")
 core=pwd.getpwnam("plebeian-friday");public=grp.getgrnam("plebeian-friday-public");req(core.pw_uid==CORE_UID and core.pw_gid==PUBLIC_GID and public.gr_gid==PUBLIC_GID,"ACCOUNT")
 req((STAGE.is_dir() and not STAGE.is_symlink()) if stage_should_exist else (not STAGE.exists() and not STAGE.is_symlink()),"STAGE_STATE")
 req(not GUARD.exists() and not GUARD.is_symlink() and not INCOMING.exists() and not INCOMING.is_symlink(),"GUARD_RELEASE_SLOT")
 node=raw_record("/opt/plebeian-auctions-friday/releases/separated-deploy-v1/bin/plebeian-auctions-poc");req(node["bytes"]==46580232 and node["sha256"]=="8f501da6c7b054d3b33f98f4be52c0299655fc52756af70cd59cbc5740afd7c4" and node["uid"]==0 and node["mode"]=="0755","LEGACY_NODE")
 for path in payload["absentPaths"]:req(not Path(path).exists() and not Path(path).is_symlink(),"CONTROL_SLOT:"+path)
 return {"services":services(payload),"currentFiles":verify_files(payload["currentFiles"]),"legacyNode":node}
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
  after=os.fstat(sfd);fields=lambda item:(item.st_dev,item.st_ino,item.st_mode,item.st_size,item.st_mtime_ns,item.st_ctime_ns,item.st_nlink);req(fields(before)==fields(after),"COPY_SOURCE_CHANGED:"+str(source));os.fchmod(dfd,mode);os.fchown(dfd,uid,gid);os.fsync(dfd)
 finally:
  if dfd>=0:os.close(dfd)
  os.close(sfd)
 return raw_record(destination)
def fsync_dir(path):
 descriptor=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:os.fsync(descriptor)
 finally:os.close(descriptor)
def rename_no_replace(source,destination):
 libc=ctypes.CDLL(None,use_errno=True);function=getattr(libc,"renameat2",None);req(function is not None,"RENAMEAT2_UNAVAILABLE");result=function(-100,os.fsencode(source),-100,os.fsencode(destination),1)
 if result!=0:
  error=ctypes.get_errno();raise OSError(error,os.strerror(error),str(source),str(destination))
def append_journal(descriptor,event,**fields):
 raw=(json.dumps({"event":event,"timeNs":time.time_ns(),**fields},sort_keys=True,separators=(",",":"))+"\n").encode();os.write(descriptor,raw);os.fsync(descriptor)
def run_guard(item):
 process=subprocess.run(["/usr/sbin/runuser","-u",item["user"],"-g","plebeian-friday-public","--",*item["argv"]],text=True,capture_output=True,timeout=90);req(process.returncode==0,"GUARD_FAILED:"+item["name"]+":"+process.stdout[:1000]+process.stderr[:1000]);return process.stdout.strip()

payload=json.loads(sys.stdin.buffer.read(2000000));phase=payload["phase"]
try:
 if phase=="preflight":
  values=preconditions(payload,False);print(json.dumps({"schema":"PLEBEIAN_SIDEQUEST_LEGACY_GUARD_REMOTE_V1","status":"PREFLIGHT_PASS","role":payload["role"],**values},sort_keys=True,separators=(",",":")))
 elif phase=="prepare":
  preconditions(payload,False);os.mkdir(STAGE,0o700);os.chown(STAGE,0,0);fsync_dir(STAGE.parent);print(json.dumps({"schema":"PLEBEIAN_SIDEQUEST_LEGACY_GUARD_REMOTE_V1","status":"STAGE_CREATED","role":payload["role"],"stage":str(STAGE)},sort_keys=True,separators=(",",":")))
 elif phase=="finalize":
  before=preconditions(payload,True);expected={item["stageName"]:item for item in payload["stageFiles"]};req({path.name for path in STAGE.iterdir()}==set(expected),"STAGE_ENTRIES");staged={}
  for name,item in expected.items():
   value=raw_record(STAGE/name);req(value["bytes"]==item["bytes"] and value["sha256"]==item["sha256"] and value["uid"]==0,"STAGE_FILE:"+name);staged[name]=value
  journal=STAGE/"JOURNAL.jsonl";jfd=os.open(journal,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
  try:
   append_journal(jfd,"PREFLIGHT_RECHECK_PASS")
   os.mkdir(INCOMING,0o755);os.mkdir(INCOMING/"bin",0o755);release={}
   for item in payload["guardFiles"]:release[item["destination"]]=write_create(STAGE/item["stageName"],INCOMING/item["destination"],0o755,0,0)
   fsync_dir(INCOMING/"bin");fsync_dir(INCOMING);rename_no_replace(INCOMING,GUARD);fsync_dir(RELEASES);append_journal(jfd,"GUARD_RELEASE_PUBLISHED",files=release)
   unit_after=None;guards=[];daemon=False
   if payload["role"]=="APP":
    item=payload["unit"];current=Path(item["path"]);now=raw_record(current,1048576);req(now["bytes"]==item["predecessorBytes"] and now["sha256"]==item["predecessorSha256"],"OBSERVER_UNIT_CHANGED");write_create(current,item["retained"],0o644,0,0);write_create(STAGE/item["stageName"],item["incoming"],0o644,0,0);os.replace(item["incoming"],current);fsync_dir(current.parent);unit_after=raw_record(current,1048576);append_journal(jfd,"OBSERVER_UNIT_INSTALLED",unit=unit_after)
    verify=subprocess.run(["/usr/bin/systemd-analyze","verify",*payload["verifyUnits"]],text=True,capture_output=True,timeout=60);req(verify.returncode==0,"SYSTEMD_ANALYZE:"+verify.stdout[:1000]+verify.stderr[:1000]);reload=subprocess.run(["/usr/bin/systemctl","daemon-reload"],text=True,capture_output=True,timeout=30);req(reload.returncode==0,"DAEMON_RELOAD:"+reload.stderr[:1000]);daemon=True
    for item in payload["guards"]:guards.append({"name":item["name"],"stdout":run_guard(item)})
   after=services(payload);append_journal(jfd,"POSTCHECK_PASS",services=after,guards=guards)
   actual={"schema":"PLEBEIAN_SIDEQUEST_LEGACY_GUARD_HOST_ACTUAL_V1","status":"APP_GUARD_CONTINUATION_COMPLETE" if payload["role"]=="APP" else "VALIDATOR_GUARD_RELEASE_READY_FOR_BASE_ADOPTION","planSha256":PLAN,"role":payload["role"],"guardRelease":str(GUARD),"releaseFiles":release,"unitAfter":unit_after,"services":after,"guards":guards,"daemonReloaded":daemon,"servicesStartedStoppedEnabledDisabledOrRestarted":False,"privateFileContentsOrHashesRead":False,"credentialsCreated":False,"paymentsPerformed":False}
   raw=(json.dumps(actual,sort_keys=True,separators=(",",":"))+"\n").encode();afd=os.open(STAGE/"ACTUAL.json",os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600);os.write(afd,raw);os.fsync(afd);os.close(afd);fsync_dir(STAGE);print(raw.decode(),end="")
  finally:os.close(jfd)
 elif phase=="reconcile":
  actual=STAGE/"ACTUAL.json"
  if actual.is_file() and not actual.is_symlink():print(actual.read_text(),end="")
  else:print(json.dumps({"schema":"PLEBEIAN_SIDEQUEST_LEGACY_GUARD_RECONCILE_V1","status":"PARTIAL_OR_UNCERTAIN","role":payload["role"],"stage":meta(STAGE),"guardRelease":meta(GUARD),"services":services(payload)},sort_keys=True,separators=(",",":")))
 else:raise Stop("PHASE")
except (Stop,OSError,ValueError,KeyError,TypeError,subprocess.SubprocessError) as error:
 print(json.dumps({"schema":"PLEBEIAN_SIDEQUEST_LEGACY_GUARD_REMOTE_V1","status":"STOPPED_PRESERVE_STATE_NO_RETRY","role":payload.get("role"),"phase":phase,"category":str(error),"stage":meta(STAGE),"guardRelease":meta(GUARD)},sort_keys=True,separators=(",",":")))
 raise SystemExit(1)
'''


def remote(host: dict, payload: dict, timeout: int = 120) -> subprocess.CompletedProcess[bytes]:
    command = BASE.ssh_base(host) + [
        " ".join(
            shlex.quote(value)
            for value in ["/usr/bin/python3", "-c", GUARD_REMOTE]
        )
    ]
    return subprocess.run(
        command,
        input=(json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n").encode(),
        env=ENV,
        capture_output=True,
        timeout=timeout,
    )


def parse(process: subprocess.CompletedProcess[bytes], category: str) -> dict:
    if process.returncode != 0:
        raise Stop(
            category
            + ":returncode="
            + str(process.returncode)
            + ":stdout="
            + process.stdout.decode("utf-8", "replace")[:5000]
            + ":stderr="
            + process.stderr.decode("utf-8", "replace")[:5000]
        )
    try:
        return json.loads(process.stdout)
    except Exception as error:
        raise Stop(category + ":INVALID_JSON") from error


def source_record(path: Path) -> dict:
    return BASE.record(path)


def guard_sources(role: str) -> list[Path]:
    values = [
        HERE / "verify-sidequest-legacy-node-target.py",
        REPO / "deploy/friday/separated/verify-friday-separated-target.py",
        REPO / "deploy/friday/verify-friday-runtime-target.py",
    ]
    if role == "APP":
        values.append(HERE / "plebeian-friday-observer-successor-guard.service")
    return values


def stage(host: dict, sources: list[Path], destination: str) -> None:
    command = [
        "/usr/bin/scp", "-q", "-p", "-o", "BatchMode=yes",
        "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes",
        "-o", "UserKnownHostsFile=" + host["known"],
        "-o", "GlobalKnownHostsFile=/dev/null", "-o", "PasswordAuthentication=no",
        "-o", "KbdInteractiveAuthentication=no", "-o", "ForwardAgent=no",
        "-o", "ClearAllForwardings=yes", "-o", "ConnectTimeout=12",
        *[str(path) for path in sources],
        "root@" + host["ip"] + ":" + destination + "/",
    ]
    process = subprocess.run(command, env=ENV, capture_output=True, timeout=600)
    if process.returncode != 0:
        raise Stop(
            "SCP_FAILED_PRESERVE_STAGE:"
            + host["role"]
            + ":"
            + process.stderr.decode("utf-8", "replace")[:4000]
        )


def expected_file(path: str, size: int, digest: str, mode: str = "0755", gid: int = 0) -> dict:
    return {"path": path, "bytes": size, "sha256": digest, "mode": mode, "uid": 0, "gid": gid}


def guard_payload(host: dict, records: dict[str, dict]) -> dict:
    role = host["role"]
    services = (
        [
            "plebeian-friday-fips.service",
            "plebeian-friday-mint.service",
            "plebeian-friday-observer.service",
            "plebeian-friday-site.service",
            "plebeian-friday-authority.service",
            "plebeian-friday-coordinator.service",
        ]
        if role == "APP"
        else [
            "plebeian-friday-fips.service",
            "plebeian-friday-validator.service",
            "plebeian-friday-signer.service",
        ]
    )
    active = (
        ["plebeian-friday-fips.service", "plebeian-friday-mint.service"]
        if role == "APP"
        else ["plebeian-friday-fips.service"]
    )
    current: list[dict] = []
    absent = [
        "/etc/systemd/system/.plebeian-friday-"
        + ("observer" if role == "APP" else "validator")
        + ".pre-sidequest-mvp-r4-guard-v1.service",
        "/etc/systemd/system/.plebeian-friday-"
        + ("observer" if role == "APP" else "validator")
        + ".sidequest-mvp-r4-guard-v1-incoming.service",
    ]
    if role == "APP":
        current.extend([
            expected_file("/etc/systemd/system/plebeian-friday-observer.service", 1157, "7a9c4f65782a78aa3814c9112971f3a7904012ef17591016915113487de1736c", "0644"),
            expected_file("/etc/systemd/system/plebeian-friday-site.service", 1404, "dffaa560f8b79beff1f76553b3d2c1cb4e041b82dac403da01c6aab8a95f22fc", "0644"),
            expected_file("/etc/systemd/system/plebeian-friday-authority.service", 1819, "657cfe6a205d500d93117943d3d7aec9c52e0617e599cd11e8d5ad30297c19b7", "0644"),
            expected_file("/etc/systemd/system/plebeian-friday-coordinator.service", 1598, "10c1bb4e8b126f7be4893f3543aa4e3402f5c24830c600f6a70c0a8fd4399fa5", "0644"),
            expected_file("/etc/plebeian-auctions-friday/application.json", 1000, "253427ca537fb143022d48f4539e939cf01f729cbf444368d9faea75c6badeee", "0640", 988),
            expected_file("/etc/plebeian-auctions-friday/friday.env", 2283, "797f56d4115de50d827cbf6c4c7c5c7be56ba5b0145d19beaa9236f65949016a", "0640", 988),
            expected_file("/etc/plebeian-auctions-friday/browser-r20-pins.json", 904, "df6e8ea5ad73397558393acfeac4313d6e0c810baa65eb85b749297ea3bc9fab", "0640", 988),
            expected_file("/etc/plebeian-auctions-friday/health-r20-pins.json", 1134, "b6d28b268b732006d12cf52c529486e1377ab38ba51f3f570b0a0b56e9f19012", "0640", 988),
            expected_file("/etc/plebeian-auctions-friday/sidequest-runtime-bindings.json", 2943, "86a5c6920ce64793006c33481685f4c4bfe8e621e2cda4b580645aa4f0c51526", "0640", 988),
            expected_file("/var/lib/plebeian-auctions-friday/separated-inputs/runtime-binding.json", 17716, "b3e2632ddd5f2b4601b7b91ac9880ce9274767cfeff5c8b5b80aabdd79e9551a", "0640", 988),
            expected_file("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4/bin/plebeian-auctions-mvp", 46588440, "ab92ff6d0552f8de88208636cdad77dff3863ee8ef325eb04352e635e93e20c5"),
            expected_file("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4/bin/plebeian-friday-authority", 99171906, "af51ff40ddafa496169cb15731c1ab8cf2b3b569f707dfd7f69719c9d294755d"),
            expected_file("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4/bin/plebeian-friday-coordinator", 98655955, "2671bb59de2b8a63ffd34721f28c97b59098935503f322ac833b0339d6e6a777"),
            expected_file("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4/bin/plebeian-friday-terminal-executor", 98846552, "630f63ed3549812d43f585aa019b20aa90ffa863119f5b505406eaa47a518460"),
            expected_file("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4/bin/verify-sidequest-runtime.py", 9498, "35456a9169986c53c627e850a159d14a6ed8ac76001dedb2ccc988cc28d0e824"),
            expected_file("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4/bin/verify-friday-separated-target.py", 5023, "6be04d9d58c90c47dd0a3cd65a1e1402977c6e3e3c64e12187c0f0763330fe5d"),
            expected_file("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4/bin/verify-friday-separated-base.py", 14659, "36bc33672b1cd2bef0961c7a7df160686cb2674e62242784303a64d652515f1d"),
            expected_file("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4/bin/verify-friday-runtime-target.py", 24764, "d5c7031676fa3e5dc15a5da5c11a8d20c44e5f5e53242b3407df90b1c026b206"),
        ])
        unit = {
            "path": "/etc/systemd/system/plebeian-friday-observer.service",
            "stageName": "plebeian-friday-observer-successor-guard.service",
            "retained": "/etc/systemd/system/.plebeian-friday-observer.pre-sidequest-mvp-r4-guard-v1.service",
            "incoming": "/etc/systemd/system/.plebeian-friday-observer.sidequest-mvp-r4-guard-v1-incoming.service",
            "predecessorBytes": 1157,
            "predecessorSha256": "7a9c4f65782a78aa3814c9112971f3a7904012ef17591016915113487de1736c",
        }
        verify_units = [
            "/etc/systemd/system/plebeian-friday-observer.service",
            "/etc/systemd/system/plebeian-friday-site.service",
            "/etc/systemd/system/plebeian-friday-authority.service",
            "/etc/systemd/system/plebeian-friday-coordinator.service",
        ]
        guards = [
            {"name": "observer", "user": "plebeian-friday", "argv": ["/usr/bin/python3", "-I", "-S", "-B", GUARD_RELEASE + "/bin/verify-friday-separated-target.py", "--environment", "/etc/plebeian-auctions-friday/friday.env", "--application", "/etc/plebeian-auctions-friday/application.json", "--service", "plebeian-friday-observer.service"]}
        ]
        guards.extend(
            {"name": name, "user": "plebeian-friday-site" if name == "site" else "plebeian-friday", "argv": ["/usr/bin/python3", "-I", "-S", "-B", "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4/bin/verify-friday-separated-target.py", "--environment", "/etc/plebeian-auctions-friday/friday.env", "--application", "/etc/plebeian-auctions-friday/application.json", "--service", "plebeian-friday-" + name + ".service"]}
            for name in ("site", "authority", "coordinator")
        )
    else:
        current.extend([
            expected_file("/etc/systemd/system/plebeian-friday-validator.service", 1102, "182b76011668fbe88639ddae2a09528d8ac574b9510876b9a65f39150e354ce9", "0644"),
            expected_file(
                "/etc/systemd/system/plebeian-friday-validator.service.d/20-separated-state.conf",
                105,
                {"V1": "fa7a39e63f648db56fb44228424cb1680650e054ca8b84489436406df01794e7", "V2": "85fd8a8c7cdc79fa92b7bc9c491a8343a8f112fcac1644b08b4f047a7a7c74cb", "V3": "e47e2e076a6786140a92e1960737fd366dece07574fca749de35c2eae5651d90", "V4": "fcda50b4917e2d86e1001b5b0f79b184b01b6444902a5bc7a1dcc1a3b9be21d6"}[role],
                "0644",
            ),
        ])
        unit = None
        verify_units = []
        guards = []
    release_files = [
        {"stageName": "verify-sidequest-legacy-node-target.py", "destination": "bin/verify-friday-separated-target.py"},
        {"stageName": "verify-friday-separated-target.py", "destination": "bin/verify-friday-separated-base.py"},
        {"stageName": "verify-friday-runtime-target.py", "destination": "bin/verify-friday-runtime-target.py"},
    ]
    return {
        "planSha256": PLAN_SHA256,
        "role": role,
        "services": services,
        "activeServices": active,
        "currentFiles": current,
        "absentPaths": absent,
        "guardFiles": release_files,
        "stageFiles": [
            {"stageName": name, "bytes": value["bytes"], "sha256": value["sha256"]}
            for name, value in sorted(records.items())
        ],
        "unit": unit,
        "verifyUnits": verify_units,
        "guards": guards,
    }


def validate_guard_sources(records: dict[str, dict], plan: dict, role: str) -> None:
    expected = {
        Path(value["source"]).name: (value["bytes"], value["sha256"])
        for value in plan["guardRelease"]["files"]
    }
    if role == "APP":
        value = plan["unitExpansion"]["app"]
        expected[Path(value["successorSource"]).name] = (
            value["successorBytes"], value["successorSha256"]
        )
    require(set(records) == set(expected), "GUARD_SOURCE_SET:" + role)
    for name, (size, digest) in expected.items():
        require(
            records[name]["bytes"] == size and records[name]["sha256"] == digest,
            "GUARD_SOURCE_DIGEST:" + role + ":" + name,
        )


def expanded_validator_adoption(host: dict, config_root: Path, plan: dict) -> tuple[list[Path], dict]:
    sources, records = BASE.local_sources(host, config_root)
    BASE.validate_local_sources(host, records, json.loads(BASE.PLAN.read_text()))
    validator_unit = HERE / "plebeian-friday-validator-successor-guard.service"
    validator_record = source_record(validator_unit)
    expected = plan["unitExpansion"]["validators"]
    require(
        validator_record["bytes"] == expected["successorBytes"]
        and validator_record["sha256"] == expected["successorSha256"],
        "VALIDATOR_UNIT_SOURCE",
    )
    sources.append(validator_unit)
    records[validator_unit.name] = validator_record
    value = BASE.payload(host, records)
    value["units"].insert(0, {
        "name": "plebeian-friday-validator.service",
        "stageName": validator_unit.name,
        "path": "/etc/systemd/system/plebeian-friday-validator.service",
        "retained": "/etc/systemd/system/.plebeian-friday-validator.pre-sidequest-mvp-r4-guard-v1.service",
        "incoming": "/etc/systemd/system/.plebeian-friday-validator.sidequest-mvp-r4-guard-v1-incoming.service",
        "predecessorBytes": expected["currentBytes"],
        "predecessorSha256": expected["currentSha256"],
    })
    value["guards"][0]["argv"][4] = GUARD_RELEASE + "/bin/verify-friday-separated-target.py"
    return sources, value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--approved-plan-sha256", required=True)
    args = parser.parse_args()
    require(args.approved_plan_sha256 == PLAN_SHA256, "APPROVAL_DIGEST")
    require(sha(PLAN.read_bytes()) == PLAN_SHA256, "PLAN_BYTES")
    plan = json.loads(PLAN.read_text())
    require(
        plan["schema"] == "PLEBEIAN_SIDEQUEST_LEGACY_NODE_GUARD_CONTINUATION_PLAN_V1",
        "PLAN_SCHEMA",
    )
    require(BASE.AGENT.is_socket(), "SSH_AGENT_SOCKET")
    agent = subprocess.run(
        ["/usr/bin/ssh-add", "-l"], env=ENV, text=True, capture_output=True, timeout=10
    )
    require(
        agent.returncode == 0
        and AGENT_FINGERPRINT in agent.stdout
        and len(agent.stdout.splitlines()) == 1,
        "SSH_AGENT_IDENTITY",
    )
    for host in HOSTS:
        require(
            sha(Path(host["known"]).read_bytes()) == host["knownSha256"],
            "KNOWN_HOSTS:" + host["role"],
        )

    with tempfile.TemporaryDirectory(prefix="sidequest-guard-continuation-", dir="/tmp") as temporary:
        config_root = BASE.render_approved_config(Path(temporary))
        guard_prepared = []
        validator_prepared = []
        for host in HOSTS:
            sources = guard_sources(host["role"])
            records = {path.name: source_record(path) for path in sources}
            validate_guard_sources(records, plan, host["role"])
            value = guard_payload(host, records)
            checked = parse(remote(host, {**value, "phase": "preflight"}), "GUARD_PREFLIGHT:" + host["role"])
            require(checked["status"] == "PREFLIGHT_PASS", "GUARD_PREFLIGHT_STATUS:" + host["role"])
            guard_prepared.append((host, sources, value))
            if host["role"] != "APP":
                base_sources, base_value = expanded_validator_adoption(host, config_root, plan)
                checked_base = BASE.parse_remote(
                    BASE.remote(host, {**base_value, "phase": "preflight"}),
                    "BASE_PREFLIGHT:" + host["role"],
                )
                require(checked_base["status"] == "PREFLIGHT_PASS", "BASE_PREFLIGHT_STATUS:" + host["role"])
                base_value["expectedConfigBefore"] = {
                    name: {"bytes": item["bytes"], "sha256": item["sha256"]}
                    for name, item in checked_base["configBefore"].items()
                }
                validator_prepared.append((host, base_sources, base_value))
        print(json.dumps({"progress": "ALL_FIVE_GUARD_PREFLIGHTS_AND_FOUR_BASE_PREFLIGHTS_PASS"}, sort_keys=True), flush=True)

        app_host, app_sources, app_value = guard_prepared[0]
        prepared = parse(remote(app_host, {**app_value, "phase": "prepare"}), "GUARD_PREPARE:APP")
        require(prepared["status"] == "STAGE_CREATED", "GUARD_PREPARE_STATUS:APP")
        stage(app_host, app_sources, GUARD_STAGE)
        app_process = remote(app_host, {**app_value, "phase": "finalize"}, timeout=240)
        if app_process.returncode != 0:
            reconciliation = remote(app_host, {**app_value, "phase": "reconcile"}, timeout=60)
            raise Stop("APP_GUARD_FINALIZE_FAILED_NO_RETRY:" + app_process.stdout.decode("utf-8", "replace")[:5000] + ":reconcile=" + reconciliation.stdout.decode("utf-8", "replace")[:5000])
        app_actual = parse(app_process, "GUARD_FINALIZE:APP")
        require(app_actual["status"] == "APP_GUARD_CONTINUATION_COMPLETE", "APP_GUARD_STATUS")
        print(json.dumps({"progress": "APP_GUARD_CONTINUATION_COMPLETE"}, sort_keys=True), flush=True)

        validator_actuals = []
        guard_by_role = {value[0]["role"]: value for value in guard_prepared[1:]}
        for host, base_sources, base_value in validator_prepared:
            guard_host, guard_source_values, guard_value = guard_by_role[host["role"]]
            guard_prepare = parse(remote(guard_host, {**guard_value, "phase": "prepare"}), "GUARD_PREPARE:" + host["role"])
            require(guard_prepare["status"] == "STAGE_CREATED", "GUARD_PREPARE_STATUS:" + host["role"])
            stage(guard_host, guard_source_values, GUARD_STAGE)
            base_prepare = BASE.parse_remote(BASE.remote(host, {**base_value, "phase": "prepare"}), "BASE_PREPARE:" + host["role"])
            require(base_prepare["status"] == "STAGE_CREATED", "BASE_PREPARE_STATUS:" + host["role"])
            BASE.stage(host, base_sources)
            guard_process = remote(guard_host, {**guard_value, "phase": "finalize"}, timeout=180)
            if guard_process.returncode != 0:
                reconciliation = remote(guard_host, {**guard_value, "phase": "reconcile"}, timeout=60)
                raise Stop("GUARD_FINALIZE_FAILED_NO_RETRY:" + host["role"] + ":" + guard_process.stdout.decode("utf-8", "replace")[:5000] + ":reconcile=" + reconciliation.stdout.decode("utf-8", "replace")[:5000])
            guard_actual = parse(guard_process, "GUARD_FINALIZE:" + host["role"])
            require(guard_actual["status"] == "VALIDATOR_GUARD_RELEASE_READY_FOR_BASE_ADOPTION", "GUARD_STATUS:" + host["role"])
            base_process = BASE.remote(host, {**base_value, "phase": "finalize"}, timeout=240)
            if base_process.returncode != 0:
                reconciliation = BASE.remote(host, {**base_value, "phase": "reconcile"}, timeout=60)
                raise Stop("BASE_FINALIZE_FAILED_NO_RETRY:" + host["role"] + ":" + base_process.stdout.decode("utf-8", "replace")[:5000] + ":reconcile=" + reconciliation.stdout.decode("utf-8", "replace")[:5000])
            base_actual = BASE.parse_remote(base_process, "BASE_FINALIZE:" + host["role"])
            require(base_actual["status"] == "INACTIVE_ADOPTION_COMPLETE_SERVICES_NOT_STARTED", "BASE_STATUS:" + host["role"])
            validator_actuals.append({"role": host["role"], "guard": guard_actual, "adoption": base_actual})
            print(json.dumps({"progress": "VALIDATOR_INACTIVE_ADOPTION_COMPLETE", "role": host["role"]}, sort_keys=True), flush=True)

    print(json.dumps({
        "schema": "PLEBEIAN_SIDEQUEST_LEGACY_GUARD_CONTINUATION_ACTUAL_V1",
        "status": "FIVE_HOST_INACTIVE_ADOPTION_COMPLETE_SERVICES_NOT_STARTED",
        "planSha256": PLAN_SHA256,
        "app": app_actual,
        "validators": validator_actuals,
        "servicesStartedStoppedEnabledDisabledOrRestarted": False,
        "authorityStateInitialized": False,
        "privateFileContentsOrHashesRead": False,
        "credentialsCreated": False,
        "paymentsPerformed": False,
        "firewallHttpsOrNginxChanged": False,
    }, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop, subprocess.SubprocessError) as error:
        print("LEGACY_NODE_GUARD_CONTINUATION=STOPPED:" + str(error), file=sys.stderr)
        raise SystemExit(1)
