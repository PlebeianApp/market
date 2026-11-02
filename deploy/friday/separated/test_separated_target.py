"""Pure/template regression; no installed paths, credentials or services."""
import copy
import json
import runpy
import unittest
from pathlib import Path
HERE=Path(__file__).parent
g=runpy.run_path(str(HERE/'verify-friday-separated-target.py'))
class TargetTest(unittest.TestCase):
 def fixture(self,role='APPLICATION',slot=0):
  a=json.loads((HERE/'application-app.json.example').read_text());a.update(role=role,participant_id=slot,application_fips_ula='fd42::5',fips_ulas=['fd42::1','fd42::2','fd42::3','fd42::4'])
  e={**g['PATHS'],**g['PORTS'],**{k:'a'*64 for k in g['PINS']},**{k:'false' for k in g['FLAGS']},'FRIDAY_ROLE':role,'FRIDAY_FIPS_UNDERLAY_IPV4':'139.162.161.233' if slot==0 else ['172.105.64.142','172.105.95.57','172.104.240.217','172.104.253.247'][slot-1],'FRIDAY_FIPS_ULA':f'fd42::{5 if slot==0 else slot}'}
  if slot==0:e.update(FRIDAY_OBSERVER_RECEIPT_SHA256='b'*64,FRIDAY_OBSERVER_NODE_ID='c'*40)
  else:e['FRIDAY_SLOT']=str(slot)
  return e,a
 def test_app_services_and_four_signers(self):
  for role,slot in [('APPLICATION',0)]+[('VALIDATOR_SIGNER',i) for i in range(1,5)]:
   e,a=self.fixture(role,slot)
   for kind in ({'fips'}|g['APP_SERVICES'] if slot==0 else {'fips'}|g['VALIDATOR_SERVICES']):self.assertEqual(g['verify_values'](e,a,'plebeian-friday-'+kind+'.service'),kind)
 def test_cross_role_service_and_fifth_slot_rejected(self):
  e,a=self.fixture()
  for kind in ['signer','validator']:self.assertRaises(ValueError,g['verify_values'],e,a,'plebeian-friday-'+kind+'.service')
  e,a=self.fixture('VALIDATOR_SIGNER',1)
  for kind in ['observer','mint','site','authority','coordinator']:self.assertRaises(ValueError,g['verify_values'],e,a,'plebeian-friday-'+kind+'.service')
  a['participant_id']=5;self.assertRaises(ValueError,g['verify_values'],e,a,'plebeian-friday-signer.service')
 def test_old_ports_paths_identity_and_extra_slots_rejected(self):
  e,a=self.fixture()
  for key,value in [('FRIDAY_RPC_PORT','26657'),('FRIDAY_NETWORK_ROOT','/var/lib/plebeian-auctions-friday/network-r20'),('FRIDAY_FIPS_UNDERLAY_IPV4','172.105.95.57'),('FRIDAY_OBSERVER_NODE_ID','f'*39)]:
   b={**e,key:value};self.assertRaises(ValueError,g['verify_values'],b,a,'plebeian-friday-site.service')
  self.assertRaises(ValueError,g['verify_values'],{**e,'FRIDAY_SLOT':'2'},a,'plebeian-friday-site.service')
  for key,value in [('cashu_mint_url','https://172.105.95.57'),('application_host_slot',2),('application_fips_ula','fd42::1'),('comet_rpc_port',26657)]:
   self.assertRaises(ValueError,g['verify_values'],e,{**a,key:value},'plebeian-friday-site.service')
 def test_pre_genesis_only_transport_and_fake_mint_can_start(self):
  e,a=self.fixture();e['FRIDAY_SEPARATED_RUNTIME_DIGEST']='%UNRENDERED%'
  for k in ['fips','mint']:self.assertEqual(g['verify_values'](e,a,'plebeian-friday-'+k+'.service'),k)
  for k in ['observer','site','authority','coordinator']:self.assertRaises(ValueError,g['verify_values'],e,a,'plebeian-friday-'+k+'.service')
 def test_signer_writable_root_is_one_slot(self):
  for slot in range(1,5):
   _,a=self.fixture('VALIDATOR_SIGNER',slot);text=g['signer_dropin'](a)
   self.assertEqual(text,'[Service]\nReadWritePaths=\nReadWritePaths=/var/lib/plebeian-auctions-friday/frost-v3/keyset-v3 /var/lib/plebeian-auctions-friday/separated/node-'+str(slot)+'\n')
  _,a=self.fixture();self.assertRaises(ValueError,g['signer_dropin'],a)
 def test_units_are_confined_and_roles_separated(self):
  for kind in g['APP_SERVICES']|g['VALIDATOR_SERVICES']|{'fips'}:
   text=(HERE/f'plebeian-friday-{kind}.service').read_text()
   self.assertEqual(text.count('[Unit]'),1);self.assertEqual(text.count('ExecStart='),1)
   self.assertIn('/releases/separated-deploy-v1/',text);self.assertIn('verify-friday-separated-target.py',text);self.assertIn('ProtectSystem=strict',text)
   self.assertIn('MemoryMax=',text);self.assertIn('LogNamespace=plebeian-friday-separated',text)
   if kind in {'authority','coordinator','site'}:self.assertNotIn('plebeian-friday-validator.service',text);self.assertNotIn('plebeian-friday-signer.service',text)
  observer=(HERE/'plebeian-friday-observer.service').read_text();self.assertIn('observer --home',observer);self.assertIn('--expected-observer-receipt-sha256 ${FRIDAY_OBSERVER_RECEIPT_SHA256}',observer);self.assertNotIn('--slot',observer);self.assertIn('network-separated/observer',observer)
  signer=(HERE/'plebeian-friday-signer.service').read_text();self.assertNotIn('--r20-profile',signer);self.assertIn('Restart=no',signer)
 def test_proxy_has_no_rpc_or_signer_route(self):
  t=(HERE/'nginx-normal.conf.example').read_text();self.assertIn('[%FRIDAY_APPLICATION_ULA%]:3438',t);self.assertIn('Host 139.162.161.233',t);self.assertNotIn('27657',t);self.assertNotIn('39101',t)
  self.assertEqual(t.count('proxy_set_header Accept-Encoding "";'),1)
  recovery=(HERE/'nginx-recovery.conf.example').read_text();self.assertEqual(recovery.count('proxy_set_header Accept-Encoding "";'),2)

# Real directory traversal/modes, synthetic UID metadata: no chown/accounts/root.
import os
import stat
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
legacy=runpy.run_path(str(HERE.parent/'verify-friday-runtime-target.py'))
class OwnershipTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)/'state';self.root.mkdir(mode=0o755)
  self.owners={self.root:0};self.original=Path.lstat
 def tearDown(self):self.tmp.cleanup()
 def directory(self,relative,uid=0,mode=0o755):
  p=self.root/relative;p.mkdir(parents=True,exist_ok=True);p.chmod(mode);self.owners[p]=uid;return p
 def metadata(self,p,*args,**kwargs):
  raw=self.original(p,*args,**kwargs);parts=list(raw);parts[4]=self.owners.get(p,raw.st_uid);return os.stat_result(parts)
 def check(self,path,owner,parents=()):
  with patch.object(Path,'lstat',lambda p,*a,**kw:self.metadata(p,*a,**kw)):g['private_directory'](legacy,path,'fixture',self.root,owner,parents)
 def test_one_public_root_accepts_distinct_private_leaves(self):
  mint=self.directory('mint',1102,0o700);self.directory('separated');signer=self.directory('separated/node-1',1103,0o700)
  self.check(mint,1102);self.check(signer,1103)
  with patch.object(Path,'lstat',lambda p,*a,**kw:self.metadata(p,*a,**kw)):legacy['_managed_path'](self.root,'public root',self.root,{0},'directory')
 def test_requester_init_recovery_and_keyset_have_exact_private_parent(self):
  for parent,leaf in [('coordinator-v3','runtime'),('frost-v3','keyset-v3'),('fips','identity')]:
   d=self.directory(parent,1103,0o700);p=self.directory(parent+'/'+leaf,1103,0o700)
   self.check(p,1103,(d,));self.assertRaises(ValueError,self.check,p,1103)
   d.chmod(0o750);self.assertRaises(ValueError,self.check,p,1103,(d,));d.chmod(0o700)
 def test_wrong_owners_public_writable_parent_and_symlinks_reject(self):
  p=self.directory('mint',1102,0o700)
  self.assertRaises(ValueError,self.check,p,1103)
  self.owners[self.root]=1102;self.assertRaises(ValueError,self.check,p,1102);self.owners[self.root]=0
  self.root.chmod(0o775);self.assertRaises(ValueError,self.check,p,1102);self.root.chmod(0o755)
  p.chmod(0o750);self.assertRaises(ValueError,self.check,p,1102);p.chmod(0o700)
  link=self.root/'alias';link.symlink_to(p);self.assertRaises(ValueError,self.check,link,1102)
  self.assertRaises(ValueError,self.check,p,0)
  self.assertRaises(ValueError,self.check,p,1102,(self.root,))
 def test_public_group_does_not_grant_private_read_or_traverse(self):
  # POSIX DAC model over actual fixture modes and synthetic distinct owners;
  # this is not kernel cross-UID execution or an installed-service canary.
  for owner in [1102,1103]:
   p=self.directory('private-'+str(owner),owner,0o700);key=p/'key';key.write_text('synthetic');key.chmod(0o600)
   for caller in [1101,1102,1103]:
    dmode=stat.S_IMODE(p.stat().st_mode);fmode=stat.S_IMODE(key.stat().st_mode)
    bits=(dmode>>6)&7 if caller==owner else (dmode>>3)&7
    read=(fmode>>6)&7 if caller==owner else (fmode>>3)&7
    self.assertEqual(bool(bits&1 and read&4),caller==owner)

class AccountContractTest(unittest.TestCase):
 def users(self,name):return SimpleNamespace(pw_uid={'plebeian-friday':1103,'plebeian-friday-site':1101,'plebeian-friday-mint':1102}[name])
 def group(self,name):self.assertEqual(name,'plebeian-friday-public');return SimpleNamespace(gr_gid=1200)
 def test_app_accounts_distinct_and_effective_role_exact(self):
  for kind,uid in [('site',1101),('mint',1102),('authority',1103),('coordinator',1103),('observer',1103),('fips',1103)]:
   accounts,gid=g['service_accounts'](kind,True,self.users,self.group,uid,1200);self.assertEqual(len(accounts),3);self.assertEqual(gid,1200)
   self.assertRaises(ValueError,g['service_accounts'],kind,True,self.users,self.group,999,1200)
   self.assertRaises(ValueError,g['service_accounts'],kind,True,self.users,self.group,uid,999)
 def test_missing_aliased_root_accounts_and_public_group_reject(self):
  for user in [lambda n:SimpleNamespace(pw_uid=0),lambda n:SimpleNamespace(pw_uid=1103)]:self.assertRaises(ValueError,g['service_accounts'],'site',True,user,self.group,1103,1200)
  self.assertRaises(ValueError,g['service_accounts'],'site',True,self.users,lambda n:SimpleNamespace(gr_gid=0),1101,0)
  self.assertRaises(KeyError,g['service_accounts'],'site',True,lambda n:{}[n],self.group,1101,1200)
 def test_validator_needs_only_core_account(self):
  def only_core(n):self.assertEqual(n,'plebeian-friday');return SimpleNamespace(pw_uid=1103)
  self.assertEqual(g['service_accounts']('signer',False,only_core,self.group,1103,1200)[0],{'plebeian-friday':1103})
 def test_units_and_exact_validator_mount(self):
  for kind in g['APP_SERVICES']|g['VALIDATOR_SERVICES']|{'fips'}:
   t=(HERE/f'plebeian-friday-{kind}.service').read_text()
   expected='plebeian-friday-site' if kind=='site' else 'plebeian-friday-mint' if kind=='mint' else 'plebeian-friday'
   self.assertIn('User='+expected+'\n',t);self.assertIn('Group=plebeian-friday-public\n',t)
   if kind=='site':self.assertNotIn('ReadWritePaths=',t)
   if kind=='mint':self.assertIn('ReadWritePaths=/var/lib/plebeian-auctions-friday/mint\n',t);self.assertNotIn('coordinator-v3',t)
   if kind in {'authority','coordinator'}:self.assertIn('coordinator-v3/runtime',t)
  t=(HERE/'plebeian-friday-validator.service').read_text();self.assertNotIn('ReadWritePaths=/var/lib/plebeian-auctions-friday/network-separated\n',t)
  for slot in range(1,5):
   _,a=TargetTest().fixture('VALIDATOR_SIGNER',slot)
   self.assertEqual(g['validator_dropin'](a),'[Service]\nReadWritePaths=\nReadWritePaths=/var/lib/plebeian-auctions-friday/network-separated/validator-'+str(slot)+'\n')

class StartupHierarchyTest(unittest.TestCase):
 """Actual guard orchestration and filesystem traversal, synthetic ownership only."""
 def run_fixture(self,application=True,slot=0,bad_owner=None):
  with tempfile.TemporaryDirectory() as t:
   base=Path(t);config=base/'etc';release=base/'opt/releases/separated-deploy-v1';state=base/'state';anchor=base/'anchor'
   owners={};original=Path.lstat
   def directory(p,uid=0,mode=0o755):p.mkdir(parents=True,exist_ok=True);p.chmod(mode);owners[p]=uid
   def file(p,text='',mode=0o640):directory(p.parent);p.write_text(text);p.chmod(mode);owners[p]=0
   for p in (config,release,state,anchor):directory(p)
   # No operational files: all contents are public fixtures or inert markers.
   file(release/'bin/verify-friday-runtime-target.py',(HERE.parent/'verify-friday-runtime-target.py').read_text())
   for name in ['verify-friday-separated-target.py','fips','plebeian-auctions-poc','plebeian-friday-authority','plebeian-friday-coordinator','plebeian-friday-signer']:file(release/'bin'/name)
   file(base/'opt/.venv/bin/python')
   ns=g['verify'].__globals__;oldstate=g['STATE'];oldconfig=g['CONFIG'];oldrelease=g['RELEASE'];oldanchor=g['ANCHOR']
   def mapped(value):
    for old,new in [(str(oldstate),str(state)),(str(oldconfig),str(config)),(str(oldrelease),str(release)),(str(oldanchor),str(anchor))]:value=value.replace(old,new)
    return value
   e,a=TargetTest().fixture('APPLICATION' if application else 'VALIDATOR_SIGNER',slot)
   e={k:mapped(v) for k,v in e.items()};a={k:mapped(v) if isinstance(v,str) else v for k,v in a.items()}
   network=state/'network-separated'
   for name in ['network.json','network-facts.json','deployment-anchor.json','comet-genesis-bundle.json','observer.json']:file(network/name,'{}')
   file(config/'health-r20-pins.json','{}');file(config/'mint.env','FIXTURE=1\n',0o600)
   for key,p in [('FRIDAY_NETWORK_FACTS_SHA256',network/'network-facts.json'),('FRIDAY_DEPLOYMENT_ANCHOR_SHA256',network/'deployment-anchor.json'),('POC_FRIDAY_HEALTH_PINS_SHA256',config/'health-r20-pins.json'),('FRIDAY_OBSERVER_RECEIPT_SHA256',network/'observer.json')]:
    if key in e:e[key]=__import__('hashlib').sha256(p.read_bytes()).hexdigest()
   directory(state/'fips');directory(state/'fips/identity',1103,0o700);directory(state/'fips',1103,0o700)
   if application:
    directory(state/'mint',1102,0o700);directory(state/'coordinator-v3');directory(state/'coordinator-v3/runtime',1103,0o700);directory(state/'coordinator-v3',1103,0o700);directory(anchor,1103,0o700);directory(network/'observer',1103,0o700)
   else:
    directory(state/'separated');directory(state/f'separated/node-{slot}',1103,0o700)
    directory(state/'frost-v3');directory(state/'frost-v3/keyset-v3',1103,0o700);directory(state/'frost-v3',1103,0o700)
    directory(network/f'validator-{slot}',1103,0o700)
   file(config/'application.json',json.dumps(a));file(config/'friday.env',''.join(k+'='+v+'\n' for k,v in sorted(e.items())))
   # Drop-in path is deliberately fixed by production. Its metadata/content is
   # a narrowly mocked fixture; no write to /etc or unit installation occurs.
   drops={Path('/etc/systemd/system/plebeian-friday-'+k+'.service.d/20-separated-state.conf'):mapped(g[k+'_dropin'](a)) for k in ['signer','validator']} if not application else {}
   # The confined build intentionally has no host /etc. Mock every fixed
   # drop-in ancestor rather than falling back to the operator's filesystem.
   drop_directories={parent for drop in drops for parent in drop.parents if parent!=Path('/')}
   realread=Path.read_text
   def metadata(p,*args,**kwargs):
    if p in drops or p in drop_directories:
     return os.stat_result([stat.S_IFREG|0o644 if p in drops else stat.S_IFDIR|0o755,0,0,1,0,1200,0,0,0,0])
    raw=original(p,*args,**kwargs);parts=list(raw)
    if p==base or base in p.parents:parts[4]=owners.get(p,0)
    if bad_owner and p==state/bad_owner:parts[4]=1101
    return os.stat_result(parts)
   update={'CODE':base/'opt','CONFIG':config,'RELEASE':release,'STATE':state,'ANCHOR':anchor,'__file__':str(release/'bin/verify-friday-separated-target.py'),'PATHS':{k:mapped(v) for k,v in g['PATHS'].items()},'APP_PATHS':{k:mapped(v) for k,v in g['APP_PATHS'].items()}}
   with patch.dict(ns,update),patch.object(Path,'lstat',lambda p,*a,**kw:metadata(p,*a,**kw)),patch.object(Path,'read_text',lambda p,*a,**kw:drops[p] if p in drops else realread(p,*a,**kw)),patch.object(__import__('pwd'),'getpwnam',AccountContractTest().users),patch.object(__import__('grp'),'getgrnam',lambda n:SimpleNamespace(gr_gid=1200)),patch.object(os,'getegid',lambda:1200):
    for kind in (['fips','mint','observer','site','authority','coordinator'] if application else ['fips','signer','validator']):
     uid=1101 if kind=='site' else 1102 if kind=='mint' else 1103
     with patch.object(os,'geteuid',lambda:uid):g['verify'](config/'friday.env',config/'application.json','plebeian-friday-'+kind+'.service')
 def test_app_actual_guard_accepts_mixed_configured_hierarchy(self):self.run_fixture()
 def test_all_four_validator_actual_guards_accept_private_leaves(self):
  for slot in range(1,5):self.run_fixture(False,slot)
 def test_no_host_etc_metadata_or_content_dependency(self):
  original_stat=Path.lstat;original_read=Path.read_text;accesses=[]
  def absent_stat(p,*args,**kwargs):
   if p==Path('/etc') or Path('/etc') in p.parents:
    accesses.append(('metadata',str(p)));raise FileNotFoundError('host /etc unavailable in focused fixture')
   return original_stat(p,*args,**kwargs)
  def absent_read(p,*args,**kwargs):
   if p==Path('/etc') or Path('/etc') in p.parents:
    accesses.append(('content',str(p)));raise FileNotFoundError('host /etc unavailable in focused fixture')
   return original_read(p,*args,**kwargs)
  with patch.object(Path,'lstat',absent_stat),patch.object(Path,'read_text',absent_read):
   self.run_fixture()
   for slot in range(1,5):self.run_fixture(False,slot)
  self.assertEqual(accesses,[])
 def test_foreign_site_owner_of_core_or_mint_state_rejects(self):
  for p in ['coordinator-v3/runtime','mint']:
   with self.subTest(path=p):self.assertRaises(ValueError,self.run_fixture,True,0,p)

if __name__=='__main__':unittest.main()
