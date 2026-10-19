"""Integration checks against the loopback-only test service. Synthetic data only."""
import urllib.request, urllib.error, http.cookiejar, json, time
BASE='http://127.0.0.1:8766'
jar=http.cookiejar.CookieJar()
client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
checks=[]
def request(path='/api.php', method='GET', payload=None, headers=None, opener=client):
    if isinstance(payload,dict): payload=json.dumps(payload).encode()
    req=urllib.request.Request(BASE+path,data=payload,method=method,headers=headers or {})
    try: response=opener.open(req)
    except urllib.error.HTTPError as error: response=error
    raw=response.read().decode()
    try: body=json.loads(raw)
    except ValueError: body=raw
    return response.status,body,dict(response.headers)
def check(name,condition):
    assert condition,name
    checks.append(name);print('PASS:',name)
s,b,h=request();check('CSRF e modo de teste',s==200 and b.get('mode')=='local-test' and len(b['csrf'])==64)
csrf=b['csrf'];headers={'Content-Type':'application/json','X-CSRF-Token':csrf}
check('Cache e indexação desabilitados',h.get('Cache-Control')=='no-store' and 'noindex' in h.get('X-Robots-Tag',''))
s,b,h=request('/');check('Página cinematográfica integrada',s==200 and 'api.php' in b and 'consent_test' in b)
data={'name':'Pessoa Fictícia HTTP','phone':'6999999'+str(int(time.time())%10000).zfill(4),'consent_test':True}
check('Bloqueio sem CSRF',request(method='POST',payload=data,headers={'Content-Type':'application/json'})[0]==403)
check('Bloqueio sem sessão',request(method='POST',payload=data,headers=headers,opener=urllib.request.build_opener())[0]==403)
check('Formato inválido',request(method='POST',payload=b'teste',headers={'Content-Type':'text/plain'})[0]==415)
check('JSON inválido',request(method='POST',payload=b'{',headers=headers)[0]==400)
check('Limite de tamanho',request(method='POST',payload=b'x'*8193,headers=headers)[0]==413)
check('Método inválido',request(method='DELETE')[0]==405)
check('Host externo rejeitado',request(headers={'Host':'example.invalid'})[0]==503)
check('Host IPv6 externo rejeitado',request(headers={'Host':'[2001:db8::1]'})[0]==503)
invalid=dict(data,phone='123')
check('Validação dos campos',request(method='POST',payload=invalid,headers=headers)[0]==422)
s,accepted,h=request(method='POST',payload=data,headers=headers);check('Inclusão aceita',s==202)
s,duplicate,h=request(method='POST',payload=dict(data,name='Outro Nome Fictício'),headers=headers)
check('Duplicidade sem revelar cadastro',s==202 and duplicate==accepted and set(accepted)=={'message'})
for _ in range(3): check('Tentativa permitida na janela',request(method='POST',payload=data,headers=headers)[0]==202)
check('Limite de tentativas aplicado',request(method='POST',payload=data,headers=headers)[0]==429)
print(f'RESULT: {len(checks)} HTTP checks passed')
