<?php
declare(strict_types=1);
$file=__DIR__.'/../mysql/Settings.php';
if(!is_file($file)){fwrite(STDERR,"FAIL: configuração segura de homologação MySQL ainda não implementada\n");exit(1);}
require $file;
function check(bool $value,string $label):void{if(!$value)throw new RuntimeException('FAIL '.$label);echo 'PASS '.$label."\n";}
function denied(array $env):bool{try{mysqlHomologationSettings($env);return false;}catch(RuntimeException $e){return !str_contains($e->getMessage(),'private-test-password');}}
$good=['ADS_MYSQL_HOMOLOGATION'=>'1','ADS_MYSQL_HOST'=>'127.0.0.1','ADS_MYSQL_PORT'=>'3306','ADS_MYSQL_DATABASE'=>'ads_hml_ci','ADS_MYSQL_USER'=>'ci_test','ADS_MYSQL_PASSWORD'=>'private-test-password'];
$config=mysqlHomologationSettings($good);
check($config['dsn']==='mysql:host=127.0.0.1;port=3306;dbname=ads_hml_ci;charset=utf8mb4','DSN restrito e charset explícito');
check(denied(array_replace($good,['ADS_MYSQL_HOMOLOGATION'=>'0'])),'nega execução sem modo de homologação');
check(denied(array_replace($good,['ADS_MYSQL_HOST'=>'mysql.producao.invalid'])),'nega conexão com host remoto');
check(denied(array_replace($good,['ADS_MYSQL_DATABASE'=>'producao'])),'nega banco sem prefixo exclusivo de teste');
check(denied(array_replace($good,['ADS_MYSQL_DATABASE'=>'ads_hml_ci;host=prod'])),'nega injeção de DSN no nome do banco');
check(denied(array_replace($good,['ADS_MYSQL_PORT'=>'3306;dbname=prod'])),'nega injeção de DSN na porta');
check(denied(array_replace($good,['ADS_MYSQL_PORT'=>'70000'])),'nega porta fora da faixa');
check(denied(array_replace($good,['ADS_MYSQL_PASSWORD'=>''])),'nega senha ausente');
check(denied(array_replace($good,['ADS_MYSQL_USER'=>''])),'nega usuário ausente');
check(mysqlHomologationSettings(array_replace($good,['ADS_MYSQL_HOST'=>'localhost']))['host']==='localhost','permite localhost explícito');
check(denied(array_replace($good,['ADS_MYSQL_HOST'=>'[::ffff:203.0.113.1]'])),'nega endereço IPv6 externo');
echo "TOTAL 11 verificações de isolamento MySQL aprovadas\n";
