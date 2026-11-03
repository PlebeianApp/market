#!/usr/bin/env python3
"""Install the accepted public FROST package and initialize APP state once."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys


HERE = Path(__file__).resolve().parent
ACTION = HERE / "authority-init-successor-action-20261103.json"
ACTION_SHA256 = "c5533ed4d80006fd630ad0f820340d7c733f4c683bfe3d4d1207d35011138ac1"
BINDING = Path(
    "/home/maximoto/Documents/Codex/2026-10-28/task-2/"
    "post-dkg-genesis-prerequisites-r1/separated-runtime-binding.json"
)
BINDING_SHA256 = "b3e2632ddd5f2b4601b7b91ac9880ce9274767cfeff5c8b5b80aabdd79e9551a"
PACKAGE_PATH = (
    "/var/lib/plebeian-auctions-friday/frost-v3/keyset-v3/exchange/"
    "friday-demo-20261030-separated-v1-dkg1/participant-1.public.json"
)
PACKAGE_BYTES = 301
PACKAGE_SHA256 = "954382a53b3589dc0b6069df298c803d2cebcfdec9502645f3c0264e668bdde5"
AGENT = Path("/tmp/ssh-1UGv8p0CgFNJ/agent.263905")
AGENT_FINGERPRINT = "SHA256:IGu9dXOSXw4JoPmwNjAgDRI2AY+zJil/haJGjKRYt34"
HOST = "139.162.161.233"
KNOWN_HOSTS = Path(
    "/home/maximoto/Documents/Codex/2026-10-28/task-4/"
    "app-https-fresh-guest-read-r2/known-hosts/APP"
)
KNOWN_HOSTS_SHA256 = "8894056c53a52d1b8c8ebc4941830530edebf9fd2b8a41e4baab7215a4c16dd7"


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def unique(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise Stop("DUPLICATE_JSON_KEY:" + key)
        result[key] = value
    return result


REMOTE = r'''
import base64,hashlib,json,os,pwd,grp,re,sqlite3,stat,subprocess,sys,time
from pathlib import Path

ACTION_SHA256="c5533ed4d80006fd630ad0f820340d7c733f4c683bfe3d4d1207d35011138ac1"
PACKAGE_SHA256="954382a53b3589dc0b6069df298c803d2cebcfdec9502645f3c0264e668bdde5"
STATE=Path("/var/lib/plebeian-auctions-friday")
RUNTIME=STATE/"coordinator-v3/runtime"
ANCHOR=Path("/var/lib/plebeian-auctions-friday-anchor-separated")
V1=STATE/"separated-inputs/.sidequest-mvp-r4-authority-init-v1"
ACTION_DIR=STATE/"separated-inputs/.sidequest-mvp-r4-authority-init-successor-v1"
PACKAGE_DIRS=[STATE/"frost-v3",STATE/"frost-v3/keyset-v3",STATE/"frost-v3/keyset-v3/exchange",STATE/"frost-v3/keyset-v3/exchange/friday-demo-20261030-separated-v1-dkg1"]
PACKAGE=PACKAGE_DIRS[-1]/"participant-1.public.json"
BINARY=Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4/bin/plebeian-friday-authority")
APPLICATION=Path("/etc/plebeian-auctions-friday/application.json")
ENVIRONMENT=Path("/etc/plebeian-auctions-friday/friday.env")
GUARD=Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4/bin/verify-friday-separated-target.py")
RUNTIME_TARGETS=["terminal.sqlite3","operations.sqlite3","authority.sqlite3","private.sqlite3","recovery.sqlite3","signer-anchor.sqlite3","funding-replay.sqlite3","funding-broadcast.sqlite3","funding-abort.sqlite3","funding-abort-sessions.sqlite3","admission-sessions.sqlite3","terminal-exchange.sqlite3","seller-plan.sqlite3"]
ANCHOR_TARGETS=["coordinator.sqlite3","funding-replay.sqlite3","funding-broadcast.sqlite3","funding-abort.sqlite3","seller-plan.sqlite3"]
SERVICES=["plebeian-friday-fips.service","plebeian-friday-mint.service","plebeian-friday-observer.service","plebeian-friday-site.service","plebeian-friday-authority.service","plebeian-friday-coordinator.service"]
ACTIVE={"plebeian-friday-fips.service","plebeian-friday-mint.service"}

class Stop(Exception):pass
def req(value,category):
 if not value:raise Stop(category)
def raw_record(path,limit=150000000,hash_file=True):
 path=Path(path);descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  before=os.fstat(descriptor);req(stat.S_ISREG(before.st_mode) and before.st_nlink==1,"UNSAFE_FILE:"+str(path));req(before.st_size<=limit,"TOO_LARGE:"+str(path));value=hashlib.sha256();total=0
  while True:
   block=os.read(descriptor,min(1048576,limit+1-total))
   if not block:break
   total+=len(block);req(total<=limit,"TOO_LARGE:"+str(path))
   if hash_file:value.update(block)
  after=os.fstat(descriptor);fields=lambda item:(item.st_dev,item.st_ino,item.st_mode,item.st_size,item.st_mtime_ns,item.st_ctime_ns,item.st_nlink);req(fields(before)==fields(after),"FILE_CHANGED:"+str(path))
  return {"path":str(path),"bytes":total,"sha256":value.hexdigest() if hash_file else None,"mode":f"{stat.S_IMODE(before.st_mode):04o}","uid":before.st_uid,"gid":before.st_gid,"nlink":before.st_nlink}
 finally:os.close(descriptor)
def meta(path):
 path=Path(path)
 try:value=path.lstat()
 except FileNotFoundError:return {"path":str(path),"exists":False}
 return {"path":str(path),"exists":True,"type":"dir" if stat.S_ISDIR(value.st_mode) else "file" if stat.S_ISREG(value.st_mode) else "other","bytes":value.st_size,"mode":f"{stat.S_IMODE(value.st_mode):04o}","uid":value.st_uid,"gid":value.st_gid,"nlink":value.st_nlink}
def exact_dir(path,mode,uid,gid):
 value=Path(path).lstat();req(stat.S_ISDIR(value.st_mode) and not Path(path).is_symlink() and stat.S_IMODE(value.st_mode)==mode and value.st_uid==uid and value.st_gid==gid,"DIRECTORY:"+str(path))
def service(name):
 process=subprocess.run(["/usr/bin/systemctl","show",name,"--property=LoadState,ActiveState,SubState,UnitFileState,FragmentPath","--no-pager"],text=True,capture_output=True,timeout=10);req(process.returncode==0,"SYSTEMD_SHOW:"+name);return {key:value for key,value in (line.split("=",1) for line in process.stdout.splitlines() if "=" in line)}
def services():
 values={name:service(name) for name in SERVICES}
 for name,value in values.items():req(value.get("ActiveState")==('active' if name in ACTIVE else 'inactive'),"SERVICE_STATE:"+name)
 jobs=subprocess.run(["/usr/bin/systemctl","list-jobs","--all","--no-legend","--no-pager"],text=True,capture_output=True,timeout=10);req(jobs.returncode==0,"SYSTEMD_JOBS")
 for name in SERVICES:req(name not in jobs.stdout,"SERVICE_JOB:"+name)
 return values
def parse_environment():
 result={}
 for line in ENVIRONMENT.read_text().splitlines():
  if not line or line.startswith('#'):continue
  key,separator,value=line.partition('=');req(separator=='=' and re.fullmatch('[A-Z0-9_]+',key) is not None and key not in result and '\x00' not in value,"ENVIRONMENT_FORMAT");result[key]=value
 req(len(result)==32,"ENVIRONMENT_FIELDS")
 return result
def identity_metadata():
 expected={"coordinator-rpc-identity.key":65,"coordinator-rpc-identity.public.json":488};req({path.name for path in RUNTIME.iterdir()}==set(expected),"RUNTIME_PRE_ENTRIES");result=[]
 for name,size in expected.items():
  value=raw_record(RUNTIME/name,1024,False);req(value["bytes"]==size and value["mode"]=="0600" and value["uid"]==999 and value["gid"]==988,"IDENTITY_METADATA:"+name);value.pop("sha256");result.append(value)
 return result
def targets_absent():
 for path in [*(RUNTIME/name for name in RUNTIME_TARGETS),*(ANCHOR/name for name in ANCHOR_TARGETS)]:req(not path.exists() and not path.is_symlink(),"TARGET_PRESENT:"+str(path))
def run_guard():
 process=subprocess.run(["/usr/sbin/runuser","-u","plebeian-friday","-g","plebeian-friday-public","--","/usr/bin/python3","-I","-S","-B",str(GUARD),"--environment",str(ENVIRONMENT),"--application",str(APPLICATION),"--service","plebeian-friday-authority.service"],text=True,capture_output=True,timeout=90);req(process.returncode==0,"AUTHORITY_GUARD:"+process.stdout[:1000]+process.stderr[:1000]);return process.stdout.strip()
def preserved_v1():
 action=raw_record(V1/"ACTION.json",10000);stopped=raw_record(V1/"STOPPED.json",10000)
 req(action["sha256"]=="57167f5e81f07094c996246e58c629966bfd8a9166e27edf56c566e4454da6f6" and action["mode"]=="0600" and action["uid"]==0 and action["gid"]==0,"V1_ACTION")
 req(stopped["sha256"]=="b4daf712198b244d6e076385ae1ad3bae5a400e6d02411f27291b11924d3fa63" and stopped["mode"]=="0600" and stopped["uid"]==0 and stopped["gid"]==0,"V1_STOPPED")
 req(not (V1/"ACTUAL.json").exists() and not (V1/"ACTUAL.json").is_symlink(),"V1_ACTUAL_PRESENT")
 return {"action":action,"stopped":stopped}
def preconditions(action_raw,package_raw):
 req(hashlib.sha256(action_raw.encode()).hexdigest()==ACTION_SHA256,"ACTION_BINDING");action=json.loads(action_raw);req(action["schema"]=="PLEBEIAN_SIDEQUEST_AUTHORITY_INIT_SUCCESSOR_ACTION_V1","ACTION_SCHEMA")
 req(len(package_raw)==301 and hashlib.sha256(package_raw).hexdigest()==PACKAGE_SHA256,"PACKAGE_PAYLOAD")
 user=pwd.getpwnam("plebeian-friday");group=grp.getgrnam("plebeian-friday-public");req(user.pw_uid==999 and user.pw_gid==988 and group.gr_gid==988,"SERVICE_ACCOUNT")
 exact_dir(STATE,0o750,0,988);exact_dir(RUNTIME,0o700,999,988);exact_dir(ANCHOR,0o700,999,988);exact_dir(STATE/"separated-inputs",0o750,0,988)
 binary=raw_record(BINARY);req(binary["bytes"]==99171906 and binary["sha256"]=="af51ff40ddafa496169cb15731c1ab8cf2b3b569f707dfd7f69719c9d294755d" and binary["uid"]==0 and binary["gid"]==0 and binary["mode"]=="0755","AUTHORITY_BINARY")
 application=raw_record(APPLICATION,1048576);environment=raw_record(ENVIRONMENT,1048576);req(application["sha256"]=="253427ca537fb143022d48f4539e939cf01f729cbf444368d9faea75c6badeee" and environment["sha256"]=="797f56d4115de50d827cbf6c4c7c5c7be56ba5b0145d19beaa9236f65949016a","CONFIGURATION")
 req(not ACTION_DIR.exists() and not ACTION_DIR.is_symlink(),"ACTION_SLOT")
 for path in [*PACKAGE_DIRS,PACKAGE]:req(not path.exists() and not path.is_symlink(),"PACKAGE_TARGET_PRESENT:"+str(path))
 targets_absent();req(list(ANCHOR.iterdir())==[],"ANCHOR_NOT_EMPTY");identities=identity_metadata();env=parse_environment();guard=run_guard();current_services=services();v1=preserved_v1()
 return {"binary":binary,"application":application,"environment":environment,"identityMetadataOnly":identities,"environmentValues":env,"guard":guard,"services":current_services,"preservedV1":v1}
def fsync_dir(path):
 descriptor=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:os.fsync(descriptor)
 finally:os.close(descriptor)
def write_create(path,raw,mode=0o600,uid=0,gid=0):
 descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,mode)
 try:
  view=memoryview(raw)
  while view:
   written=os.write(descriptor,view);req(written>0,"WRITE:"+str(path));view=view[written:]
  os.fchmod(descriptor,mode);os.fchown(descriptor,uid,gid);os.fsync(descriptor)
 finally:os.close(descriptor)
def create_package(package_raw):
 created=[]
 for path in PACKAGE_DIRS:
  os.mkdir(path,0o750);os.chown(path,0,988);os.chmod(path,0o750);fsync_dir(path.parent);created.append(str(path))
 write_create(PACKAGE,package_raw,0o640,0,988);fsync_dir(PACKAGE.parent)
 value=raw_record(PACKAGE,65536);req(value["bytes"]==301 and value["sha256"]==PACKAGE_SHA256 and value["mode"]=="0640" and value["uid"]==0 and value["gid"]==988,"PACKAGE_INSTALLED")
 for path in PACKAGE_DIRS:exact_dir(path,0o750,0,988)
 return {"directories":created,"package":value}
def verify_databases():
 runtime_expected={"coordinator-rpc-identity.key","coordinator-rpc-identity.public.json",*RUNTIME_TARGETS};anchor_expected=set(ANCHOR_TARGETS);req({path.name for path in RUNTIME.iterdir()}==runtime_expected,"RUNTIME_POST_ENTRIES");req({path.name for path in ANCHOR.iterdir()}==anchor_expected,"ANCHOR_POST_ENTRIES")
 records=[];quick=[]
 for path in [*(RUNTIME/name for name in RUNTIME_TARGETS),*(ANCHOR/name for name in ANCHOR_TARGETS)]:
  value=raw_record(path,100000000,False);req(value["bytes"]>0 and value["mode"]=="0600" and value["uid"]==999 and value["gid"]==988,"DATABASE_METADATA:"+str(path));value.pop("sha256");records.append(value)
  connection=sqlite3.connect("file:"+str(path)+"?mode=ro&immutable=1",uri=True);rows=connection.execute("PRAGMA quick_check").fetchall();connection.close();req(rows==[("ok",)],"SQLITE_QUICK_CHECK:"+str(path));quick.append(str(path))
 def row(path,query):
  connection=sqlite3.connect("file:"+str(path)+"?mode=ro&immutable=1",uri=True);value=connection.execute(query).fetchone();connection.close();return value
 expected_deployment="friday-demo-20261030-separated-v1"
 revisions={
  "coordinator":row(RUNTIME/"operations.sqlite3","SELECT deployment_id,global_revision FROM friday_coordinator_metadata WHERE id=1"),
  "coordinatorAnchor":row(ANCHOR/"coordinator.sqlite3","SELECT deployment_id,maximum_global_revision FROM friday_coordinator_rollback_anchor WHERE id=1"),
  "fundingReplayAnchor":row(ANCHOR/"funding-replay.sqlite3","SELECT deployment_id,global_revision FROM friday_funding_replay_anchor WHERE id=1"),
  "fundingBroadcastAnchor":row(ANCHOR/"funding-broadcast.sqlite3","SELECT deployment_id,maximum_global_revision FROM friday_v4_broadcast_rollback_anchor WHERE id=1"),
  "sellerPlan":row(RUNTIME/"seller-plan.sqlite3","SELECT deployment_id,global_revision FROM friday_seller_plan_metadata WHERE id=1"),
  "sellerPlanAnchor":row(ANCHOR/"seller-plan.sqlite3","SELECT deployment_id,maximum_global_revision FROM friday_seller_plan_rollback_anchor WHERE id=1"),
 }
 for name,value in revisions.items():req(value==(expected_deployment,0),"REVISION_ZERO:"+name)
 return {"databaseMetadataOnly":records,"quickCheckOkCount":len(quick),"revisionZero":{name:{"deploymentId":value[0],"revision":value[1]} for name,value in revisions.items()}}
def write_status(name,value):
 raw=(json.dumps(value,sort_keys=True,separators=(",",":"))+"\n").encode();write_create(ACTION_DIR/name,raw);fsync_dir(ACTION_DIR);return raw

payload=json.loads(sys.stdin.buffer.read(200000));phase=payload["phase"];action_raw=payload["actionRaw"];package_raw=base64.b64decode(payload["packageBase64"],validate=True)
try:
 if phase=="preflight":
  values=preconditions(action_raw,package_raw);values.pop("environmentValues");print(json.dumps({"schema":"PLEBEIAN_SIDEQUEST_AUTHORITY_INIT_SUCCESSOR_REMOTE_V1","status":"PREFLIGHT_PASS",**values},sort_keys=True,separators=(",",":")))
 elif phase=="execute":
  values=preconditions(action_raw,package_raw);os.mkdir(ACTION_DIR,0o700);os.chown(ACTION_DIR,0,0);fsync_dir(ACTION_DIR.parent);write_create(ACTION_DIR/"ACTION.json",action_raw.encode());fsync_dir(ACTION_DIR)
  installed=create_package(package_raw)
  command=["/usr/sbin/runuser","-u","plebeian-friday","-g","plebeian-friday-public","--","/usr/bin/env","-i","PATH=/usr/bin:/bin","LANG=C","LC_ALL=C","TZ=UTC",*[key+"="+value for key,value in sorted(values["environmentValues"].items())],str(BINARY),"init-state","--application",str(APPLICATION)]
  process=subprocess.run(command,capture_output=True,timeout=180);req(process.returncode==0,"INIT_STATE_EXIT:"+str(process.returncode)+":stdout_sha256="+hashlib.sha256(process.stdout).hexdigest()+":stderr_sha256="+hashlib.sha256(process.stderr).hexdigest());req(process.stdout==b'' and process.stderr==b'',"INIT_STATE_OUTPUT")
  verified=verify_databases();guard=run_guard();after_services=services();req(after_services==values["services"],"SERVICE_STATE_CHANGED");v1=preserved_v1()
  actual={"schema":"PLEBEIAN_SIDEQUEST_AUTHORITY_INIT_SUCCESSOR_ACTUAL_V1","status":"PUBLIC_PACKAGE_INSTALLED_AUTHORITY_EMPTY_STATE_INITIALIZED_SERVICES_NOT_STARTED","actionSha256":ACTION_SHA256,"completedAtNs":time.time_ns(),"commandExit":process.returncode,"stdoutBytes":len(process.stdout),"stderrBytes":len(process.stderr),"publicPackage":installed,"identityMetadataOnly":identity_metadata(),"verification":verified,"guard":guard,"preservedV1":v1,"services":after_services,"servicesStartedStoppedEnabledDisabledOrRestarted":False,"credentialsCreated":False,"privateKeyShareOrSecretAccessed":False,"paymentsPerformed":False,"automaticRetryRollbackDeletionOrReset":False}
  raw=write_status("ACTUAL.json",actual);print(raw.decode(),end="")
 elif phase=="reconcile":
  for name in ("ACTUAL.json","STOPPED.json"):
   path=ACTION_DIR/name
   if path.is_file() and not path.is_symlink():print(path.read_text(),end="");raise SystemExit(0 if name=="ACTUAL.json" else 1)
  print(json.dumps({"schema":"PLEBEIAN_SIDEQUEST_AUTHORITY_INIT_SUCCESSOR_RECONCILE_V1","status":"UNCERTAIN_NO_RECEIPT","actionDir":meta(ACTION_DIR),"package":meta(PACKAGE),"runtimeEntriesMetadataOnly":[meta(path) for path in sorted(RUNTIME.iterdir())],"anchorEntriesMetadataOnly":[meta(path) for path in sorted(ANCHOR.iterdir())],"services":services()},sort_keys=True,separators=(",",":")));raise SystemExit(1)
 else:raise Stop("PHASE")
except (Stop,OSError,ValueError,KeyError,TypeError,sqlite3.Error,subprocess.SubprocessError) as error:
 if ACTION_DIR.is_dir() and not ACTION_DIR.is_symlink() and not (ACTION_DIR/"ACTUAL.json").exists() and not (ACTION_DIR/"STOPPED.json").exists():
  stopped={"schema":"PLEBEIAN_SIDEQUEST_AUTHORITY_INIT_SUCCESSOR_STOPPED_V1","status":"STOPPED_PRESERVE_STATE_NO_RETRY","actionSha256":ACTION_SHA256,"category":str(error),"package":meta(PACKAGE),"runtimeEntriesMetadataOnly":[meta(path) for path in sorted(RUNTIME.iterdir())],"anchorEntriesMetadataOnly":[meta(path) for path in sorted(ANCHOR.iterdir())],"services":services(),"preservedV1":preserved_v1()};write_status("STOPPED.json",stopped)
 print(json.dumps({"schema":"PLEBEIAN_SIDEQUEST_AUTHORITY_INIT_SUCCESSOR_REMOTE_V1","status":"STOPPED_PRESERVE_STATE_NO_RETRY","category":str(error)},sort_keys=True,separators=(",",":")))
 raise SystemExit(1)
'''


ENV = {
    "PATH": "/usr/bin:/bin",
    "LANG": "C",
    "LC_ALL": "C",
    "TZ": "UTC",
    "SSH_AUTH_SOCK": str(AGENT),
}


def ssh_command() -> list[str]:
    return [
        "/usr/bin/ssh", "-T", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
        "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=" + str(KNOWN_HOSTS),
        "-o", "GlobalKnownHostsFile=/dev/null", "-o", "PasswordAuthentication=no",
        "-o", "KbdInteractiveAuthentication=no", "-o", "ForwardAgent=no",
        "-o", "ClearAllForwardings=yes", "-o", "ConnectTimeout=12",
        "-o", "ConnectionAttempts=1", "root@" + HOST,
        " ".join(shlex.quote(value) for value in ["/usr/bin/python3", "-c", REMOTE]),
    ]


def remote(payload: dict, timeout: int = 240) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        ssh_command(),
        input=(json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n").encode(),
        env=ENV,
        capture_output=True,
        timeout=timeout,
    )


def parse(process: subprocess.CompletedProcess[bytes], category: str) -> dict:
    if process.returncode != 0:
        raise Stop(
            category + ":returncode=" + str(process.returncode)
            + ":stdout=" + process.stdout.decode("utf-8", "replace")[:5000]
            + ":stderr=" + process.stderr.decode("utf-8", "replace")[:5000]
        )
    try:
        return json.loads(process.stdout)
    except Exception as error:
        raise Stop(category + ":INVALID_JSON") from error


def package_from_binding() -> bytes:
    binding_raw = BINDING.read_bytes()
    require(digest(binding_raw) == BINDING_SHA256, "RUNTIME_BINDING_BYTES")
    binding = json.loads(binding_raw, object_pairs_hook=unique)
    result = binding.get("result")
    require(isinstance(result, dict), "RUNTIME_BINDING_RESULT")
    package_hex = result.get("publicKeyPackageHex")
    require(isinstance(package_hex, str), "PUBLIC_PACKAGE_HEX")
    try:
        package = bytes.fromhex(package_hex)
    except ValueError as error:
        raise Stop("PUBLIC_PACKAGE_HEX_ENCODING") from error
    require(
        result.get("publicKeyPackagePath") == PACKAGE_PATH
        and result.get("publicKeyPackageSha256") == PACKAGE_SHA256
        and len(package) == PACKAGE_BYTES
        and digest(package) == PACKAGE_SHA256,
        "PUBLIC_PACKAGE_BINDING",
    )
    return package


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--approved-action-sha256", required=True)
    args = parser.parse_args()
    action_raw = ACTION.read_bytes()
    require(args.approved_action_sha256 == ACTION_SHA256, "APPROVAL_DIGEST")
    require(digest(action_raw) == ACTION_SHA256, "ACTION_BYTES")
    package = package_from_binding()
    require(AGENT.is_socket(), "SSH_AGENT_SOCKET")
    require(digest(KNOWN_HOSTS.read_bytes()) == KNOWN_HOSTS_SHA256, "KNOWN_HOSTS")
    agent = subprocess.run(
        ["/usr/bin/ssh-add", "-l"], env=ENV, capture_output=True, text=True, timeout=10
    )
    require(
        agent.returncode == 0
        and AGENT_FINGERPRINT in agent.stdout
        and len(agent.stdout.splitlines()) == 1,
        "SSH_AGENT_IDENTITY",
    )
    payload = {
        "actionRaw": action_raw.decode("utf-8"),
        "packageBase64": base64.b64encode(package).decode("ascii"),
    }
    preflight = parse(remote({**payload, "phase": "preflight"}, 120), "PREFLIGHT")
    require(preflight["status"] == "PREFLIGHT_PASS", "PREFLIGHT_STATUS")
    print(json.dumps({"progress": "AUTHORITY_INIT_SUCCESSOR_PREFLIGHT_PASS"}, sort_keys=True), flush=True)
    process = remote({**payload, "phase": "execute"}, 300)
    if process.returncode != 0:
        reconciliation = remote({**payload, "phase": "reconcile"}, 60)
        raise Stop(
            "EXECUTE_FAILED_NO_RETRY:stdout="
            + process.stdout.decode("utf-8", "replace")[:5000]
            + ":stderr=" + process.stderr.decode("utf-8", "replace")[:5000]
            + ":reconcile_returncode=" + str(reconciliation.returncode)
            + ":reconcile=" + reconciliation.stdout.decode("utf-8", "replace")[:5000]
        )
    actual = parse(process, "EXECUTE")
    require(
        actual["status"]
        == "PUBLIC_PACKAGE_INSTALLED_AUTHORITY_EMPTY_STATE_INITIALIZED_SERVICES_NOT_STARTED",
        "EXECUTE_STATUS",
    )
    print(json.dumps(actual, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop, subprocess.SubprocessError) as error:
        print("AUTHORITY_INIT_SUCCESSOR=STOPPED:" + str(error), file=sys.stderr)
        raise SystemExit(1)
