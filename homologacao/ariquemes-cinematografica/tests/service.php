<?php
declare(strict_types=1);
if (!is_file(__DIR__.'/../src/Prelaunch.php')) {fwrite(STDERR,"FAIL: serviço de pré-cadastro ainda não implementado\n");exit(1);}
require __DIR__.'/../src/Prelaunch.php';
function ok(bool $value,string $label):void{if(!$value)throw new RuntimeException('FAIL '.$label);echo "PASS $label\n";}
function database():PDO{$db=new PDO('sqlite::memory:');$db->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);$db->exec(file_get_contents(__DIR__.'/schema.sql'));return $db;}
function payload(string $phone='69999990001'):array{return ['name'=>'Pessoa Fictícia','phone'=>$phone,'email'=>'teste@example.invalid','consent_test'=>true,'companies'=>['Empresa Fictícia']];}
function send(PDO $db,array $data=[],string $token='valid',string $client='synthetic-client',int $time=1000):array{return registerPrelaunch($db,$data?:payload(),'valid',$token,$client,$time);}
$db=database();$result=send($db);
ok($result['status']===202,'novo cadastro recebe confirmação genérica');
ok((int)$db->query('SELECT count(*) FROM prelaunch_leads')->fetchColumn()===1,'grava em banco isolado');
$again=send($db,['name'=>'Outra Pessoa','phone'=>'69999990001','consent_test'=>true]);
ok($result===$again,'telefone existente tem a mesma resposta pública sem revelar cadastro');
ok(!preg_match('/referral|founder|69999990001|Pessoa Fictícia/',json_encode($again)),'resposta não revela código número nome ou telefone');
ok((int)$db->query('SELECT count(*) FROM prelaunch_leads')->fetchColumn()===1,'duplicata não cria outro registro');
$bad=send($db,payload(),'invalid');ok($bad['status']===403,'CSRF inválido bloqueado');
$data=payload('69999990002');$data['consent_test']=false;ok(send($db,$data)['status']===422,'confirmação de teste ausente bloqueada');
$data=payload('69999990002');$data['email']='email-invalido';ok(send($db,$data)['status']===422,'email inválido bloqueado');
$data=payload('123');ok(send($db,$data)['status']===422,'telefone inválido bloqueado');
$data=payload('69999990002');$data['companies']=['A','B','C','D'];ok(send($db,$data)['status']===422,'limite de três empresas validado');
$data=payload('+55 (69) 99999-0002');ok(send($db,$data)['status']===202,'normalização do DDI brasileiro');
ok((int)$db->query('SELECT count(DISTINCT founder_number) FROM prelaunch_leads')->fetchColumn()===2,'números distintos em inscrições sequenciais');
$db->exec("UPDATE prelaunch_sequences SET last_number=800");ok(send($db,payload('69999990003'))['status']===202,'sequência preserva faixa já reservada');
ok((int)$db->query('SELECT max(founder_number) FROM prelaunch_leads')->fetchColumn()===801,'alocação usa sequência transacional');
$db=database();for($i=0;$i<5;$i++)send($db,payload());ok(send($db,payload())['status']===429,'limite de tentativas persistente para duplicatas também');
ok(send($db,payload(),'valid','synthetic-client',2000)['status']===202,'nova janela de taxa permite tentativa');
$db=database();$db->exec('DROP TABLE prelaunch_company_votes');$failed=send($db);ok($failed['status']===503,'falha de armazenamento tem recuperação explícita');
ok((int)$db->query('SELECT count(*) FROM prelaunch_leads')->fetchColumn()===0,'falha reverte cadastro parcial');
ok(!str_contains(json_encode($failed),'SQL'),'erro interno não é exposto');
echo "TOTAL 19 testes aprovados\n";
