#!/usr/bin/python3
"""Closed five-host role/path guard. Public metadata only; no credential reads.
Cryptographic owner/DKG/genesis checks remain in the actual service loaders.
"""
from __future__ import annotations
import argparse
import hashlib
import ipaddress
import json
import os
import pwd
import grp
import re
import runpy
import stat
from pathlib import Path

CONFIG=Path('/etc/plebeian-auctions-friday')
CODE=Path('/opt/plebeian-auctions-friday')
RELEASE=CODE/'releases/separated-deploy-v1'
STATE=Path('/var/lib/plebeian-auctions-friday')
ANCHOR=Path('/var/lib/plebeian-auctions-friday-anchor-separated')
DEPLOYMENT='friday-demo-20261030-separated-v1'
PATHS={
 'FRIDAY_APPLICATION':str(CONFIG/'application.json'),
 'FRIDAY_NETWORK_ROOT':str(STATE/'network-separated'),
 'FRIDAY_NETWORK_FACTS':str(STATE/'network-separated/network-facts.json'),
 'FRIDAY_DKG_RESULT':str(STATE/'separated-inputs/runtime-binding.json'),
 'FRIDAY_PARTICIPANT_BIN':str(RELEASE/'bin/coco-demo-frost-participant-3of4'),
 'FRIDAY_TERMINAL_EXECUTOR_BIN':str(RELEASE/'bin/plebeian-friday-terminal-executor'),
 'FRIDAY_COORDINATOR_DB':str(STATE/'coordinator-v3/runtime/operations.sqlite3'),
 'FRIDAY_COORDINATOR_ANCHOR_DB':str(ANCHOR/'coordinator.sqlite3'),
 'FRIDAY_FUNDING_ABORT_ANCHOR_DB':str(ANCHOR/'funding-abort.sqlite3'),
 'FRIDAY_FIPS_CONFIG':str(STATE/'fips/identity/fips.yaml'),
 'FRIDAY_FIPS_IDENTITY_KEY':str(STATE/'fips/identity/fips.key'),
}
APP_PATHS={'network_root':str(STATE/'network-separated'),'dkg_root':str(STATE/'frost-v3/keyset-v3'),
 'coordinator_root':str(STATE/'coordinator-v3/runtime'),'coordinator_rpc_identity_path':str(STATE/'coordinator-v3/runtime/coordinator-rpc-identity.key')}
PINS={'FRIDAY_DKG_MANIFEST_DIGEST','FRIDAY_SEPARATED_BOOTSTRAP_DIGEST','FRIDAY_SEPARATED_RUNTIME_DIGEST',
 'FRIDAY_OWNER_APPROVAL_PUBLIC_KEY','FRIDAY_DEPLOYMENT_ANCHOR_SHA256','FRIDAY_NETWORK_FACTS_SHA256',
 'POC_FRIDAY_BROWSER_PINS_SHA256','POC_FRIDAY_HEALTH_PINS_SHA256'}
PORTS={'FRIDAY_P2P_PORT':'27656','FRIDAY_RPC_PORT':'27657','FRIDAY_SIGNER_PORT':'39101','FRIDAY_MINT_PORT':'3438','FRIDAY_SITE_PORT':'8180'}
FLAGS={'POC_FRIDAY_BROWSER_READY','POC_FRIDAY_RECOVERY_ONLY','POC_FRIDAY_R20_CLOSE_TRIGGER'}
COMMON=set(PATHS)|PINS|set(PORTS)|FLAGS|{'FRIDAY_ROLE','FRIDAY_FIPS_UNDERLAY_IPV4','FRIDAY_FIPS_ULA'}
APP_EXTRA={'FRIDAY_OBSERVER_RECEIPT_SHA256','FRIDAY_OBSERVER_NODE_ID'}
APP_SERVICES={'observer','site','authority','coordinator','mint'}
VALIDATOR_SERVICES={'validator','signer'}

def ula(value):
 if not isinstance(value,str):raise ValueError('ULA type')
 ip=ipaddress.IPv6Address(value)
 if not ip.is_private or not value.startswith(('fc','fd')) or str(ip)!=value:raise ValueError('noncanonical FIPS ULA')
 return value

def verify_values(env,app,service):
 role=app.get('role');application=role=='APPLICATION'
 if role not in {'APPLICATION','VALIDATOR_SIGNER'}:raise ValueError('explicit separated role required')
 expected=COMMON|(APP_EXTRA if application else {'FRIDAY_SLOT'})
 if set(env)!=expected:raise ValueError('environment fields differ from exact role')
 names=set(APP_PATHS)|{'schema','role','participant_id','deployment_id','run_id','application_host_id','application_ipv4','application_fips_ula','fips_ulas','comet_p2p_port','comet_rpc_port','signer_rpc_port','mint_port','cashu_mint_url','site_port'}
 if set(app)!=names or app['schema']!='PLEBEIAN_FRIDAY_SEPARATED_APPLICATION_V1':raise ValueError('application fields/schema differ')
 for k,v in {**APP_PATHS,'deployment_id':DEPLOYMENT,'run_id':DEPLOYMENT+'-run1','application_host_id':'linode-109290386','application_ipv4':'139.162.161.233','cashu_mint_url':'https://139.162.161.233'}.items():
  if app[k]!=v:raise ValueError('fixed application pin differs: '+k)
 if env['FRIDAY_ROLE']!=role:raise ValueError('environment role differs')
 slot=app['participant_id']
 if type(slot)!=int or (slot!=0 if application else slot not in (1,2,3,4)):raise ValueError('invalid role participant')
 if not application and env['FRIDAY_SLOT']!=str(slot):raise ValueError('signer local slot differs')
 ulas=app['fips_ulas']
 if not isinstance(ulas,list) or len(ulas)!=4 or len(set(map(ula,ulas)))!=4:raise ValueError('four canonical validator ULAs required')
 appula=ula(app['application_fips_ula'])
 if appula in ulas:raise ValueError('app identity duplicates validator')
 if env['FRIDAY_FIPS_ULA']!=(appula if application else ulas[slot-1]):raise ValueError('local FIPS role differs')
 ips=['172.105.64.142','172.105.95.57','172.104.240.217','172.104.253.247']
 if env['FRIDAY_FIPS_UNDERLAY_IPV4']!=('139.162.161.233' if application else ips[slot-1]):raise ValueError('fixed host target differs')
 for k,v in PATHS.items():
  if env[k]!=v:raise ValueError('fixed path differs: '+k)
 for k,v in PORTS.items():
  if env[k]!=v:raise ValueError('port differs: '+k)
 for k,v in {'comet_p2p_port':27656,'comet_rpc_port':27657,'signer_rpc_port':39101,'mint_port':3438,'site_port':8180}.items():
  if type(app[k])!=int or app[k]!=v:raise ValueError('application port differs')
 for k in FLAGS:
  if env[k] not in {'true','false'}:raise ValueError('invalid flag')
 if not application and any(env[k]=='true' for k in ('POC_FRIDAY_BROWSER_READY','POC_FRIDAY_R20_CLOSE_TRIGGER')):raise ValueError('validator cannot activate website')
 kind=service.removeprefix('plebeian-friday-').removesuffix('.service')
 if service!='plebeian-friday-'+kind+'.service' or kind not in ({'fips'}|APP_SERVICES|VALIDATOR_SERVICES):raise ValueError('unknown service')
 if kind!='fips' and kind not in (APP_SERVICES if application else VALIDATOR_SERVICES):raise ValueError('service incompatible with host role')
 # Transport may be staged before DKG/mint/genesis. Every other service needs
 # completed independently reviewed runtime pins; placeholders never activate it.
 if kind not in {'fips','mint'}:
  for k in PINS|({'FRIDAY_OBSERVER_RECEIPT_SHA256'} if application else set()):
   if not re.fullmatch('[0-9a-f]{64}',env[k]):raise ValueError('missing exact public pin: '+k)
  if application and not re.fullmatch('[0-9a-f]{40}',env['FRIDAY_OBSERVER_NODE_ID']):raise ValueError('observer ID invalid')
 return kind

def signer_dropin(app):
 if app['role']!='VALIDATOR_SIGNER' or type(app['participant_id'])!=int or app['participant_id'] not in (1,2,3,4):raise ValueError('validator slot required')
 return '[Service]\nReadWritePaths=\nReadWritePaths='+str(STATE/'frost-v3/keyset-v3')+' '+str(STATE/f"separated/node-{app['participant_id']}")+'\n'

# Public inputs are root-owned; the common public group grants no access to
# private 0700/0600 trees. Never fall back to the invoking account or root.
CORE_USER='plebeian-friday'
SITE_USER='plebeian-friday-site'
MINT_USER='plebeian-friday-mint'
PUBLIC_GROUP='plebeian-friday-public'

def service_accounts(kind,application,user_lookup=None,group_lookup=None,euid=None,egid=None):
 user_lookup=user_lookup or pwd.getpwnam
 group_lookup=group_lookup or grp.getgrnam
 names=[CORE_USER,SITE_USER,MINT_USER] if application else [CORE_USER]
 accounts={name:user_lookup(name).pw_uid for name in names}
 if any(type(uid)!=int or uid<=0 for uid in accounts.values()) or len(set(accounts.values()))!=len(accounts):raise ValueError('distinct non-root service accounts required')
 gid=group_lookup(PUBLIC_GROUP).gr_gid
 if type(gid)!=int or gid<=0:raise ValueError('non-root public input group required')
 expected=SITE_USER if kind=='site' else MINT_USER if kind=='mint' else CORE_USER
 if expected not in accounts:raise ValueError('service account incompatible with role')
 if (os.geteuid() if euid is None else euid)!=accounts[expected] or (os.getegid() if egid is None else egid)!=gid:raise ValueError('service effective identity differs from exact unit contract')
 return accounts,gid

def private_directory(guard,path,label,managed_root,owner_uid,private_parents=()):
 """Mixed ownership without granting the service ownership of public ancestors.
 Only explicit private parents and the exact leaf are service-owned 0700.
 lstat walks the actual chain and rejects symlinks before checking ownership.
 """
 if owner_uid<=0 or not path.is_absolute() or '..' in path.parts:raise ValueError('invalid private path/owner')
 try:path.relative_to(managed_root)
 except ValueError as exc:raise ValueError(label+' escapes managed root') from exc
 private=set(private_parents)|{path}
 if any(p!=path and (p==managed_root or p not in path.parents) for p in private):raise ValueError('private parent is not a strict managed descendant')
 if any(p!=managed_root and managed_root not in p.parents for p in private):raise ValueError('private parent escapes managed root')
 chain=guard['_path_metadata'](path,label);seen=False
 for component,metadata in chain:
  if component==managed_root:seen=True
  if not seen:continue
  expected=owner_uid if component in private else 0
  mode=stat.S_IMODE(metadata.st_mode)
  if metadata.st_uid!=expected or not stat.S_ISDIR(metadata.st_mode):raise ValueError(label+' owner/type differs at '+str(component))
  if (component in private and mode!=0o700) or (component not in private and mode&0o022):raise ValueError(label+' permissions differ at '+str(component))
 if not seen:raise ValueError(label+' misses managed root')

def validator_dropin(app):
 if app['role']!='VALIDATOR_SIGNER' or type(app['participant_id'])!=int or app['participant_id'] not in (1,2,3,4):raise ValueError('validator slot required')
 return '[Service]\nReadWritePaths=\nReadWritePaths='+str(STATE/f"network-separated/validator-{app['participant_id']}")+'\n'

def verify(environment,application,service):
 if environment!=CONFIG/'friday.env' or application!=CONFIG/'application.json' or Path(__file__)!=RELEASE/'bin/verify-friday-separated-target.py':raise ValueError('fixed invocation required')
 # Reuse the reviewed path metadata guard; never source environment text.
 guard=runpy.run_path(str(RELEASE/'bin/verify-friday-runtime-target.py'))
 managed=guard['_managed_path']
 for p in (environment,application):managed(p,'root-owned configuration',CONFIG,{0},'file')
 env=guard['_read_environment'](environment)
 def unique(pairs):
  obj={}
  for k,v in pairs:
   if k in obj:raise ValueError('duplicate JSON key')
   obj[k]=v
  return obj
 app=json.loads(application.read_text(),object_pairs_hook=unique)
 kind=verify_values(env,app,service)
 accounts,gid=service_accounts(kind,app['role']=='APPLICATION')
 core=accounts[CORE_USER]
 executable=RELEASE/'bin'/('fips' if kind=='fips' else 'plebeian-auctions-poc' if kind in {'validator','observer','site'} else 'plebeian-friday-'+kind)
 if kind=='mint':executable=CODE/'.venv/bin/python'
 managed(executable,'immutable executable',CODE,{0},'file')
 for name in ('verify-friday-separated-target.py','verify-friday-runtime-target.py'):managed(RELEASE/'bin'/name,'immutable guard',RELEASE,{0},'file')
 if kind=='fips':
  private_directory(guard,STATE/'fips/identity','FIPS private identity',STATE,core,(STATE/'fips',))
  return # separate identity preflight reads private metadata only
 if kind=='mint':
  managed(CONFIG/'mint.env','root-held fake mint configuration',CONFIG,{0},'file')
  if stat.S_IMODE((CONFIG/'mint.env').lstat().st_mode)!=0o600:raise ValueError('mint secret environment must be root-only 0600')
  private_directory(guard,STATE/'mint','bounded fake mint state',STATE,accounts[MINT_USER])
  return # actual mint identity/conformance is reviewed before final genesis
 network=Path(env['FRIDAY_NETWORK_ROOT'])
 for name in ('network.json','network-facts.json','deployment-anchor.json','comet-genesis-bundle.json'):
  managed(network/name,'public network input',STATE,{0},'file')
 for path,pin in ((network/'network-facts.json','FRIDAY_NETWORK_FACTS_SHA256'),(network/'deployment-anchor.json','FRIDAY_DEPLOYMENT_ANCHOR_SHA256'),(CONFIG/'health-r20-pins.json','POC_FRIDAY_HEALTH_PINS_SHA256')):
  managed(path,'pinned public input',CONFIG if CONFIG in path.parents else STATE,{0},'file')
  if path.stat().st_size>1024*1024 or hashlib.sha256(path.read_bytes()).hexdigest()!=env[pin]:raise ValueError('public hash differs')
 if app['role']=='APPLICATION':
  for path in (STATE/'frost-v3/keyset-v3/participant.config.json',STATE/'frost-v3/keyset-v3/identity-signing-key.hex',STATE/'frost-v3/keyset-v3/kex-private-key.hex',STATE/'frost-v3/keyset-v3/signer-rpc-identity.key',STATE/'frost-v3/keyset-v3/transport-secrets.json',STATE/'frost-v3/keyset-v3/state'):
   if path.exists() or path.is_symlink():raise ValueError('app contains forbidden participant state')
  managed(network/'observer.json','observer receipt',STATE,{0},'file')
  if hashlib.sha256((network/'observer.json').read_bytes()).hexdigest()!=env['FRIDAY_OBSERVER_RECEIPT_SHA256']:raise ValueError('observer receipt hash differs')
 if kind=='signer':
  drop=Path('/etc/systemd/system/plebeian-friday-signer.service.d/20-separated-state.conf')
  managed(drop,'exact signer confinement',Path('/etc/systemd/system'),{0},'file')
  if drop.read_text()!=signer_dropin(app):raise ValueError('signer writable roots differ')
  private_directory(guard,STATE/f"separated/node-{app['participant_id']}",'signer auxiliary state',STATE,core)
  private_directory(guard,STATE/'frost-v3/keyset-v3','signer private keyset',STATE,core,(STATE/'frost-v3',))
 if kind=='validator':
  drop=Path('/etc/systemd/system/plebeian-friday-validator.service.d/20-separated-state.conf')
  managed(drop,'exact validator confinement',Path('/etc/systemd/system'),{0},'file')
  if drop.read_text()!=validator_dropin(app):raise ValueError('validator writable root differs')
  private_directory(guard,network/f"validator-{app['participant_id']}",'validator private state',STATE,core)
 if kind=='observer':private_directory(guard,network/'observer','observer private state',STATE,core)
 if kind in {'authority','coordinator'}:
  private_directory(guard,STATE/'coordinator-v3/runtime','requester runtime',STATE,core,(STATE/'coordinator-v3',))
  private_directory(guard,ANCHOR,'independent core anchors',ANCHOR,core)
 # Actual Go/TS startup loaders enforce owner signatures, DKG, public package,
 # genesis and observer receipt joins before admitting any mutable operation.

def main():
 p=argparse.ArgumentParser();p.add_argument('--environment',type=Path,required=True);p.add_argument('--application',type=Path,required=True);p.add_argument('--service',required=True);a=p.parse_args()
 try:verify(a.environment,a.application,a.service)
 except (ValueError,OSError,KeyError,TypeError) as e:p.error(str(e))
 return 0
if __name__=='__main__':raise SystemExit(main())
