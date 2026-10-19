"""Runs tests on a temporary, empty copy: never resets any existing database."""
from pathlib import Path
import subprocess, tempfile, shutil, os, time, urllib.request
root=Path(__file__).resolve().parent.parent
php=os.environ.get('PHP_BIN','php')
result=subprocess.run([php,str(root/'tests/service.php')],capture_output=True,text=True)
print(result.stdout,end='');print(result.stderr,end='')
assert result.returncode==0 and 'TOTAL 19 testes aprovados' in result.stdout,'PHP service checks failed'
safety=subprocess.run([php,str(root/'tests/mysql_safety.php')],capture_output=True,text=True)
print(safety.stdout,end='');print(safety.stderr,end='')
assert safety.returncode==0 and 'TOTAL 11 verificações de isolamento MySQL aprovadas' in safety.stdout,'MySQL isolation checks failed'
modes=['http']+(['browser'] if os.environ.get('ADS_BROWSER_CHECKS')=='1' else [])
for mode in modes:
 with tempfile.TemporaryDirectory(prefix='ads-isolated-') as tmp:
  lab=Path(tmp)
  for folder in ['public','src','tests']:shutil.copytree(root/folder,lab/folder,ignore=shutil.ignore_patterns('__pycache__'))
  shutil.copy(root/'init.php',lab/'init.php')
  env=dict(os.environ,ADS_LAB_ONLY='1')
  init=subprocess.run([php,str(lab/'init.php')],env=env,capture_output=True,text=True)
  assert 'inicializado' in init.stdout,init.stdout+init.stderr
  with open(lab/'server.log','w') as log:
   server=subprocess.Popen([php,'-S','127.0.0.1:8766','-t',str(lab/'public')],env=env,stdout=log,stderr=log)
   try:
    for _ in range(100):
     try: urllib.request.urlopen('http://127.0.0.1:8766/api.php',timeout=1);break
     except Exception:
      if server.poll() is not None:raise RuntimeError((lab/'server.log').read_text())
      time.sleep(.1)
    subprocess.run(['python',str(root/'tests/http_checks.py')] if mode=='http' else ['node',str(root/'tests/browser.cjs')],env=env,check=True)
   finally:server.terminate();server.wait()
print('RESULT: isolated checks completed')
