<?php
declare(strict_types=1);
$root=dirname(__DIR__);
if(!is_file($root.'/mysql/001_support.sql')){fwrite(STDERR,"FAIL: migração de apoio MySQL ainda não implementada\n");exit(1);}
require $root.'/mysql/Settings.php';require $root.'/src/Prelaunch.php';
function verify(bool $value,string $label):void{if(!$value)throw new RuntimeException('FAIL '.$label);echo 'PASS '.$label."\n";}
function freshData(string $phone):array{return ['name'=>'Pessoa Fictícia MySQL','phone'=>$phone,'consent_test'=>true,'companies'=>['Empresa Fictícia']];}
function registerTest(PDO $db,string $phone,string $client):array{return registerPrelaunch($db,freshData($phone),'test','test',$client,1000);}
function parallelRequests(int $count,bool $samePhone=false):array {
    $processes=[];
    for($i=0;$i<$count;$i++){
        $phone=$samePhone?'69988889999':('6998888'.str_pad((string)$i,4,'0',STR_PAD_LEFT));
        $command=[PHP_BINARY,__DIR__.'/mysql_worker.php',$phone,'synthetic-worker-'.$i];
        $process=proc_open($command,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
        if(!is_resource($process))throw new RuntimeException('Não foi possível iniciar worker de teste.');
        fclose($pipes[0]);$processes[]=[$process,$pipes];
    }
    $results=[];
    foreach($processes as [$process,$pipes]){
        $out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
        if(proc_close($process)!==0)throw new RuntimeException('Worker de homologação falhou.');
        $result=json_decode($out,true);if(!is_array($result))throw new RuntimeException('Resposta de teste não é JSON.');$results[]=$result;
    }
    return $results;
}
try{
    $db=connectMysqlHomologation();
    // Abort before any write if the dedicated database already has any table.
    if((int)$db->query('SELECT count(*) FROM information_schema.tables WHERE table_schema=DATABASE()')->fetchColumn()!==0)throw new RuntimeException('Banco de teste precisa estar vazio; nada foi apagado.');
    $db->exec(file_get_contents(__DIR__.'/mysql_fixture.sql'));
    $db->exec("INSERT INTO prelaunch_leads(founder_number,name,phone,referral_code,consent_whatsapp) VALUES(8000,'Fictício Legado','69999998000','TEST-LEGACY',0)");
    $migration=file_get_contents($root.'/mysql/001_support.sql');$db->exec($migration);
    verify((int)$db->query("SELECT last_number FROM prelaunch_sequences WHERE sequence_key='founder'")->fetchColumn()===8000,'migração preserva a faixa de fundador do legado');
    verify((int)$db->query('SELECT count(*) FROM prelaunch_leads')->fetchColumn()===1,'migração mantém os cadastros existentes');
    $accepted=registerTest($db,'69999998001','initial');verify($accepted['status']===202,'cadastro nativo MySQL aceito');
    verify((int)$db->query('SELECT MAX(founder_number) FROM prelaunch_leads')->fetchColumn()===8001,'primeiro número posterior à migração não colide');
    $db->exec($migration);verify((int)$db->query("SELECT last_number FROM prelaunch_sequences WHERE sequence_key='founder'")->fetchColumn()===8001,'reexecução da migração não reduz sequência');
    $results=parallelRequests(20);
    verify(count(array_filter($results,fn($r)=>$r===$accepted))===20,'vinte inscrições concorrentes confirmadas');
    $counts=$db->query('SELECT count(*) total,count(DISTINCT founder_number) numbers FROM prelaunch_leads')->fetch(PDO::FETCH_ASSOC);
    verify((int)$counts['total']===22&&(int)$counts['numbers']===22,'concorrência sem duplicar números de fundador');
    $results=parallelRequests(12,true);
    verify(count(array_filter($results,fn($r)=>$r===$accepted))===12,'duplicatas concorrentes têm resposta pública idêntica');
    verify((int)$db->query("SELECT count(*) FROM prelaunch_leads WHERE phone='69988889999'")->fetchColumn()===1,'duplicatas concorrentes geram apenas um cadastro');
    $before=(int)$db->query('SELECT count(*) FROM prelaunch_leads')->fetchColumn();
    $db->exec('RENAME TABLE prelaunch_company_votes TO prelaunch_company_votes_test_backup');
    try{$failure=registerTest($db,'69999998002','rollback');}finally{$db->exec('RENAME TABLE prelaunch_company_votes_test_backup TO prelaunch_company_votes');}
    verify($failure['status']===503&&(int)$db->query('SELECT count(*) FROM prelaunch_leads')->fetchColumn()===$before,'falha de gravação reverte o cadastro MySQL');
    verify((int)$db->query('SELECT count(*) FROM prelaunch_leads WHERE consent_whatsapp<>0')->fetchColumn()===0,'nenhum registro de teste autoriza contato');
    echo "TOTAL 11 verificações MySQL nativas aprovadas\n";
}catch(Throwable $e){fwrite(STDERR,"FAIL: homologação MySQL não concluída. ".($e instanceof PDOException?'Falha do banco de teste.':$e->getMessage())."\n");exit(1);}
